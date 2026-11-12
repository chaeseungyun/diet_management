import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  type ValidationError,
} from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { Response } from 'express';
import { ERROR_CODES, defaultErrorCode, isErrorCode, type ErrorCode } from '@diet/shared';

/**
 * 오류 형식 (DEC-079, api.md §0): `{ statusCode, code, message, fields? }`.
 * code 는 기계용, message 는 개발자용 영어(화면에 내지 않는다).
 */
export class ErrorFieldDto {
  /** 요청 본문 경로. 중첩은 점으로 (`items.0.quantity`) */
  @ApiProperty()
  field!: string;

  /** 어긴 규칙(class-validator 제약 이름, 예: min, isNumber) */
  @ApiProperty()
  rule!: string;
}

export class ErrorDto {
  @ApiProperty()
  statusCode!: number;

  @ApiProperty({ enum: ERROR_CODES })
  code!: ErrorCode;

  @ApiProperty()
  message!: string;

  @ApiPropertyOptional({ type: ErrorFieldDto, isArray: true })
  fields?: ErrorFieldDto[];
}

/** code 를 실은 HTTP 예외. `throw new AppException(422, 'STOCK_UNIT_LOCKED', '...')` */
export class AppException extends HttpException {
  constructor(status: number, code: ErrorCode, message: string, fields?: ErrorFieldDto[]) {
    const body: ErrorDto = { statusCode: status, code, message, ...(fields ? { fields } : {}) };
    super(body, status);
  }
}

export const unprocessable = (code: ErrorCode, message: string) =>
  new AppException(HttpStatus.UNPROCESSABLE_ENTITY, code, message);

export const conflict = (code: ErrorCode, message: string) =>
  new AppException(HttpStatus.CONFLICT, code, message);

/** ValidationPipe 실패 → 422 VALIDATION_FAILED + fields */
export function validationException(errors: ValidationError[]): AppException {
  const fields: ErrorFieldDto[] = [];
  const messages: string[] = [];
  const walk = (list: ValidationError[], prefix: string) => {
    for (const e of list) {
      const field = prefix ? `${prefix}.${e.property}` : e.property;
      for (const [rule, msg] of Object.entries(e.constraints ?? {})) {
        fields.push({ field, rule });
        messages.push(prefix ? `${prefix}.${msg}` : msg);
      }
      if (e.children?.length) walk(e.children, field);
    }
  };
  walk(errors, '');
  return new AppException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'VALIDATION_FAILED',
    messages.join(', ') || 'validation failed',
    fields,
  );
}

/**
 * 모든 예외를 ErrorDto 형식으로 맞춘다. code 없는 HttpException 은 상태별 기본 code.
 * 본문이 message 없는 객체면(헬스 체크의 `{status, db}`) 그대로 둔다.
 * HttpException 이 아닌 오류는 500 INTERNAL 로 응답하고 서버 로그에 남긴다(응답에 내부 내용 없음).
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      if (raw && typeof raw === 'object' && !('message' in raw)) {
        res.status(status).json(raw);
        return;
      }
      const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const m = typeof raw === 'string' ? raw : obj.message;
      const message = Array.isArray(m)
        ? m.join(', ')
        : typeof m === 'string'
          ? m
          : exception.message;
      const body: ErrorDto = {
        statusCode: status,
        code: isErrorCode(obj.code) ? obj.code : defaultErrorCode(status),
        message,
        ...(Array.isArray(obj.fields) ? { fields: obj.fields as ErrorFieldDto[] } : {}),
      };
      res.status(status).json(body);
      return;
    }

    // body-parser 등 express 미들웨어 오류는 status 를 들고 온다(잘못된 JSON 400, 너무 큰 본문 413)
    const s = (exception as { status?: unknown; statusCode?: unknown } | null) ?? {};
    const st = typeof s.status === 'number' ? s.status : s.statusCode;
    if (typeof st === 'number' && st >= 400 && st < 500) {
      const body: ErrorDto = {
        statusCode: st,
        code: defaultErrorCode(st),
        message: exception instanceof Error ? exception.message : 'bad request',
      };
      res.status(st).json(body);
      return;
    }

    this.logger.error(
      exception instanceof Error ? (exception.stack ?? exception.message) : String(exception),
    );
    const body: ErrorDto = {
      statusCode: 500,
      code: 'INTERNAL',
      message: 'Internal server error',
    };
    res.status(500).json(body);
  }
}

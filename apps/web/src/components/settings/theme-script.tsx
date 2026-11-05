/** 첫 렌더 전에 저장된 테마를 적용해 깜빡임을 막는다 (layout 에서 사용) */
export function ThemeScript() {
  const code = `try{var t=localStorage.getItem('theme');var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

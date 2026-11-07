-- AlterTable
ALTER TABLE "users" ADD COLUMN     "active_slots" "MealSlot"[] DEFAULT ARRAY['breakfast', 'lunch', 'afternoon_snack', 'dinner', 'evening_snack']::"MealSlot"[];

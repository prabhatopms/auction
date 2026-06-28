/*
  Warnings:

  - You are about to drop the `LotCurrencyPrice` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "LotCurrencyPrice" DROP CONSTRAINT "LotCurrencyPrice_lotId_fkey";

-- AlterTable
ALTER TABLE "Lot" ADD COLUMN     "productType" TEXT NOT NULL DEFAULT 'tshirt';

-- DropTable
DROP TABLE "LotCurrencyPrice";

-- CreateTable
CREATE TABLE "ProductPrice" (
    "id" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "startingBid" INTEGER NOT NULL,
    "minIncrement" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductPrice_productType_currency_key" ON "ProductPrice"("productType", "currency");

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'IN';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN     "displayAmount" INTEGER,
ADD COLUMN     "vendorProvider" TEXT;

-- CreateTable
CREATE TABLE "LotCurrencyPrice" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "startingBid" INTEGER NOT NULL,
    "minIncrement" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LotCurrencyPrice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LotCurrencyPrice_lotId_currency_key" ON "LotCurrencyPrice"("lotId", "currency");

-- AddForeignKey
ALTER TABLE "LotCurrencyPrice" ADD CONSTRAINT "LotCurrencyPrice_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "Lot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

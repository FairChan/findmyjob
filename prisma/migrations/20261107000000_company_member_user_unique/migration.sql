-- DropIndex
DROP INDEX "CompanyMember_userId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "CompanyMember_userId_key" ON "CompanyMember"("userId");

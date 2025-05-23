import { SQL, eq, and, desc, sql } from "drizzle-orm";
import { singleton } from "tsyringe";
import { database } from "../../common/config/database.ts";
import { PgTx } from "../custom/data-types.ts";
import {
  RepositoryOption,
  RepositoryOptionUpdate,
  RepositoryResult,
} from "../../common/types/index.d.ts";

import {
  receiptImportTable,
  InsertReceiptImport,
  UpdateReceiptImport,
  SelectReceiptImport,
} from "../schemas/receipt-import.schema.ts";
import { supplierTable } from "../schemas/supplier.schema.ts";

import { ReceiptImportStatus } from "../../modules/receipt/enums/receipt.enum.ts";

@singleton()
export class ReceiptImportRepository {
  /**
   * RECEIPT IMPORT
   */
  async createReceiptImport(data: InsertReceiptImport, tx?: PgTx) {
    const db = tx || database;
    const result = await db
      .insert(receiptImportTable)
      .values(data)
      .returning({ id: receiptImportTable.id });
    return { data: result, error: null };
  }

  async updateReceiptImport(
    opts: RepositoryOptionUpdate<UpdateReceiptImport>,
    tx?: PgTx
  ) {
    const db = tx || database;
    const filters: SQL[] = [...opts.where];

    const result = await db
      .update(receiptImportTable)
      .set(opts.set)
      .where(and(...filters))
      .returning({ id: receiptImportTable.id });

    return { data: result, error: null };
  }

  async deleteReceiptImport(id: SelectReceiptImport["id"], tx?: PgTx) {
    const db = tx || database;
    const result = await db
      .delete(receiptImportTable)
      .where(eq(receiptImportTable.id, id))
      .returning({ id: receiptImportTable.id });

    return { data: result, error: null };
  }

  async findReceiptImportById(
    id: SelectReceiptImport["id"],
    opts: Pick<RepositoryOption, "select">
  ): Promise<RepositoryResult> {
    const query = database
      .selectDistinct(opts.select)
      .from(receiptImportTable)
      .leftJoin(
        supplierTable,
        eq(supplierTable.id, receiptImportTable.supplier)
      )
      .where(and(eq(receiptImportTable.id, id)));

    const [result] = await query.execute();
    return { data: result, error: null };
  }

  async findReceiptImportByReceiptNumber(
    receiptNumber: SelectReceiptImport["receiptNumber"],
    opts: Pick<RepositoryOption, "select">
  ): Promise<RepositoryResult> {
    const query = database
      .selectDistinct(opts.select)
      .from(receiptImportTable)
      .leftJoin(
        supplierTable,
        eq(supplierTable.id, receiptImportTable.supplier)
      )
      .where(and(eq(receiptImportTable.receiptNumber, receiptNumber)));

    const [result] = await query.execute();
    return { data: result, error: null };
  }

  async findReceiptsImportByCondition(
    opts: RepositoryOption
  ): Promise<RepositoryResult> {
    let count: number | null = null;
    const filters: SQL[] = [...opts.where];

    const query = database
      .select(opts.select)
      .from(receiptImportTable)
      .leftJoin(
        supplierTable,
        eq(supplierTable.id, receiptImportTable.supplier)
      )
      .where(and(...filters));

    if (opts.orderBy) {
      query.orderBy(...opts.orderBy);
    } else {
      query.orderBy(desc(receiptImportTable.createdAt));
    }

    if (opts.limit) {
      query.limit(opts.limit);
    }

    if (opts.offset) {
      query.offset(opts.offset);
    }

    if (opts.isCount) {
      count = await database.$count(receiptImportTable, and(...filters));
    }

    const results = await query.execute();
    return { data: results, error: null, count };
  }

  async getTotalOfImportNew() {
    const count = await database
      .select({
        value: sql<number>`coalesce(sum(${receiptImportTable.totalProduct}), 0)`,
      })
      .from(receiptImportTable)
      .where(eq(receiptImportTable.status, ReceiptImportStatus.COMPLETED))
      .execute();

    if (!count.length) {
      return 0;
    }

    return +(count[0].value || 0);
  }

  async getTotalImportsByDateRange(
    startDate: string,
    endDate: string
  ): Promise<{ x: string; y: number }[]> {
    // Ensure dates are in correct format
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get all imports within date range
    const results = await database
      .select({
        date: sql<string>`DATE(${receiptImportTable.createdAt})`,
        total: sql<number>`COALESCE(SUM(${receiptImportTable.totalProduct}), 0)`,
      })
      .from(receiptImportTable)
      .where(
        and(
          sql`${
            receiptImportTable.createdAt
          }::date >= ${start.toISOString()}::date`,
          sql`${
            receiptImportTable.createdAt
          }::date <= ${end.toISOString()}::date`,
          eq(receiptImportTable.status, ReceiptImportStatus.COMPLETED)
        )
      )
      .groupBy(sql`DATE(${receiptImportTable.createdAt})`)
      .orderBy(sql`DATE(${receiptImportTable.createdAt})`);

    // Generate complete date range with zero values for missing dates
    const dataset: { x: string; y: number }[] = [];
    const currentDate = new Date(start);

    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split("T")[0];
      const dayData = results.find((r) => r.date === dateStr);

      dataset.push({
        x: dateStr,
        y: dayData ? Number(dayData.total) : 0,
      });

      currentDate.setDate(currentDate.getDate() + 1);
    }

    return dataset;
  }
}

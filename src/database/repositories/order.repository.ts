import { and, desc, eq, or, SQL } from "drizzle-orm";
import { injectable } from "tsyringe";
import { database } from "../../common/config/database.ts";
import {
  RepositoryOption,
  RepositoryOptionUpdate,
  RepositoryResult,
} from "../../common/types/index.d.ts";
import { PgTx } from "../custom/data-types.ts";
import {
  InsertOrder,
  orderTable,
  UpdateOrder,
} from "../schemas/order.schema.ts";

@injectable()
export class OrderRepository {
  async createOrder(data: InsertOrder, tx?: PgTx) {
    const db = tx || database;
    const result = await db
      .insert(orderTable)
      .values(data)
      .returning();

    if (!result.length) {
      return { data: null, error: "Can't create order" };
    }

    return { data: result[0], error: null };
  }

  async updateOrder(opts: RepositoryOptionUpdate<UpdateOrder>, tx?: PgTx) {
    const db = tx || database;
    const filters: SQL[] = [...opts.where];

    const result = await db
      .update(orderTable)
      .set(opts.set)
      .where(and(...filters))
      .returning();

    if (!result.length) {
      return { data: null, error: "Can't update order" };
    }

    return { data: result[0], error: null };
  }

  async findOrderByIdentifier(
    identifier: string,
    opts: Pick<RepositoryOption, "select">,
    tx?: PgTx
  ): Promise<RepositoryResult> {
    const db = tx || database;
    const query = db
      .selectDistinct(opts.select)
      .from(orderTable)
      .where(
        or(eq(orderTable.code, identifier), eq(orderTable.id, identifier))
      );

    const result = await query.execute();

    if (!result.length) {
      return {
        data: null,
        error: `Order not found with identifier: ${identifier}`,
      };
    }

    return { data: result[0], error: null };
  }

  async findOrdersByCondition(
    opts: RepositoryOption
  ): Promise<RepositoryResult> {
    let count: number | null = null;
    const filters: SQL[] = [...opts.where];

    const query = database
      .select(opts.select)
      .from(orderTable)
      .where(and(...filters));

    if (opts.orderBy) {
      query.orderBy(...opts.orderBy);
    } else {
      query.orderBy(desc(orderTable.createdAt));
    }

    if (opts.limit) {
      query.limit(opts.limit);
    }

    if (opts.offset) {
      query.offset(opts.offset);
    }

    if (opts.isCount) {
      count = await database.$count(orderTable, and(...filters));
    }

    const results = await query.execute();
    return { data: results, error: null, count };
  }
}

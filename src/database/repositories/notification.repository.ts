import { and, eq, SQL, sql } from "drizzle-orm";
import { singleton } from "tsyringe";
import { database } from "../../common/config/database.ts";
import {
  InsertNotification,
  notificationTable,
} from "../schemas/notification.schema.ts";
import { NotificationStatus } from "../enums/notification.enum.ts";
import { PgTx } from "../custom/data-types.ts";
import {
  RepositoryOption,
  RepositoryResult,
} from "../../common/types/index.d.ts";

@singleton()
export class NotificationRepository {
  async createNotification(
    data: InsertNotification | InsertNotification[],
    tx?: PgTx,
  ) {
    const db = tx || database;
    const result = await db.insert(notificationTable).values(
      Array.isArray(data) ? data : [data],
    ).returning();

    if (!result.length) {
      return { data: null, error: "Can't create notification" };
    }

    return { data: result[0], error: null };
  }

  async getUserNotifications(userId: string, limit = 10, offset = 0) {
    const results = await database
      .select()
      .from(notificationTable)
      .where(eq(notificationTable.userId, userId))
      .orderBy(sql`${notificationTable.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    const count = await database
      .select({ count: sql<number>`count(*)` })
      .from(notificationTable)
      .where(eq(notificationTable.userId, userId));

    return {
      data: results,
      count: count[0]?.count || 0,
      error: null,
    };
  }

  async findNotificationsByCondition(
    opts: RepositoryOption,
  ): Promise<RepositoryResult> {
    let count: number | null = null;
    const filters: SQL[] = [...opts.where];

    const query = database
      .select(opts.select)
      .from(notificationTable)
      .where(and(...filters));

    if (opts.orderBy) {
      query.orderBy(...opts.orderBy);
    } else {
      query.orderBy(sql`${notificationTable.createdAt} DESC`);
    }

    if (opts.limit) {
      query.limit(opts.limit);
    }

    if (opts.offset) {
      query.offset(opts.offset);
    }

    if (opts.isCount) {
      count = await database.$count(notificationTable, and(...filters));
    }

    const results = await query.execute();
    return { data: results, error: null, count };
  }

  async markAsRead(id: string, userId: string, tx?: PgTx) {
    const db = tx || database;
    const result = await db
      .update(notificationTable)
      .set({
        status: NotificationStatus.READ,
        readAt: new Date().toISOString(),
      })
      .where(
        and(eq(notificationTable.id, id), eq(notificationTable.userId, userId)),
      )
      .returning();

    if (!result.length) {
      return { data: null, error: "Can't mark notification as read" };
    }

    return { data: result[0], error: null };
  }

  async markAllAsRead(userId: string, tx?: PgTx) {
    const db = tx || database;
    const result = await db
      .update(notificationTable)
      .set({
        status: NotificationStatus.READ,
        readAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(notificationTable.userId, userId),
          eq(notificationTable.status, NotificationStatus.UNREAD),
        ),
      )
      .returning();

    return { data: result, error: null };
  }

  async getUnreadCount(userId: string) {
    const result = await database
      .select({ count: sql<number>`count(*)` })
      .from(notificationTable)
      .where(
        and(
          eq(notificationTable.userId, userId),
          eq(notificationTable.status, NotificationStatus.UNREAD),
        ),
      );

    return { count: result[0]?.count || 0, error: null };
  }
}

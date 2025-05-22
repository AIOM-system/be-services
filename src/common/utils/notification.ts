import { inject, singleton } from "tsyringe";
import { sendMulticastNotification, sendNotification } from "./firebase.ts";
import { NotificationRepository } from "../../database/repositories/notification.repository.ts";
import { InsertNotification } from "../../database/schemas/notification.schema.ts";
import { PgTx } from "../../database/custom/data-types.ts";

@singleton()
export class NotificationService {
  constructor(
    @inject(NotificationRepository) private notificationRepository:
      NotificationRepository,
  ) {}

  /**
   * Send notification to a single user and store in database
   */
  async sendUserNotification(
    userId: string,
    deviceToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
    tx?: PgTx,
  ) {
    // Store notification in database
    const notificationData: InsertNotification = {
      userId,
      title,
      body,
      data,
    };

    const { data: savedNotification } = await this.notificationRepository
      .createNotification(
        notificationData,
        tx,
      );

    // Send push notification if device token is provided
    if (deviceToken) {
      const result = await sendNotification(deviceToken, title, body, data);
      return {
        notification: savedNotification,
        pushResult: result,
      };
    }

    return {
      notification: savedNotification,
      pushResult: { success: false, error: "No device token provided" },
    };
  }

  /**
   * Send notification to multiple users and store in database
   */
  async sendMultiUserNotification(
    userNotifications: Array<{
      userId: string;
      deviceToken?: string;
      data?: Record<string, string>;
    }>,
    title: string,
    body: string,
    tx?: PgTx,
  ) {
    // Prepare notifications for database
    const notificationsToSave: InsertNotification[] = userNotifications.map(
      ({ userId, data }) => ({
        userId,
        title,
        body,
        data,
      }),
    );

    // Store notifications in database
    const { data: savedNotifications } = await this.notificationRepository
      .createNotification(
        notificationsToSave,
        tx,
      );

    // Collect device tokens for push notification
    const deviceTokens = userNotifications
      .map((n) => n.deviceToken)
      .filter((token): token is string => !!token);

    // Send push notifications if there are device tokens
    if (deviceTokens.length > 0) {
      const result = await sendMulticastNotification(
        deviceTokens,
        title,
        body,
        userNotifications[0].data,
      );
      return {
        notifications: savedNotifications,
        pushResult: result,
      };
    }

    return {
      notifications: savedNotifications,
      pushResult: { success: false, error: "No device tokens provided" },
    };
  }
}

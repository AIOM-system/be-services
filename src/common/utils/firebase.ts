import { cert, initializeApp, ServiceAccount } from "firebase-admin/app";
import {
  getMessaging,
  Message,
  MulticastMessage,
} from "firebase-admin/messaging";
import { isDev } from "./index.ts";

// Initialize Firebase Admin SDK
let firebaseInitialized = false;

const initializeFirebase = () => {
  if (firebaseInitialized) return;

  try {
    const serviceAccount = JSON.parse(
      Deno.env.get("FIREBASE_SERVICE_ACCOUNT") || "{}",
    ) as ServiceAccount;

    const firebaseConfig = {
      apiKey: "AIzaSyBQ9j5zKujFgZKwdlRpoTCwMwLRE-cQshM",
      authDomain: "aiom-cb8c1.firebaseapp.com",
      projectId: "aiom-cb8c1",
      storageBucket: "aiom-cb8c1.firebasestorage.app",
      messagingSenderId: "15918079515",
      appId: "1:15918079515:web:e5a04905505f57bb59a2be",
    };

    initializeApp(firebaseConfig);

    // initializeApp({
    //   credential: cert(serviceAccount),
    // });

    firebaseInitialized = true;
    console.log("Firebase initialized successfully");
  } catch (error) {
    console.error("Firebase initialization failed:", error);
    throw new Error("Firebase initialization failed");
  }
};

/**
 * Send a notification to a single device
 * @param token Device token to send notification to
 * @param title Notification title
 * @param body Notification body
 * @param data Additional data to send with notification
 * @returns Response from Firebase
 */
export const sendNotification = async (
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    if (!firebaseInitialized) {
      initializeFirebase();
    }

    const message: Message = {
      notification: {
        title,
        body,
      },
      data,
      token,
    };

    const response = await getMessaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    if (isDev()) {
      console.error("Error sending notification:", error);
    }
    return {
      success: false,
      error: (error as Error).message || "Failed to send notification",
    };
  }
};

/**
 * Send notifications to multiple devices
 * @param tokens Array of device tokens
 * @param title Notification title
 * @param body Notification body
 * @param data Additional data to send with notification
 * @returns Response from Firebase with success and failure counts
 */
export const sendMulticastNotification = async (
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<{
  success: boolean;
  successCount?: number;
  failureCount?: number;
  responses?: Array<{ success: boolean; messageId?: string; error?: string }>;
  error?: string;
}> => {
  try {
    if (!firebaseInitialized) {
      initializeFirebase();
    }

    if (!tokens.length) {
      return { success: false, error: "No device tokens provided" };
    }

    const message: MulticastMessage = {
      notification: {
        title,
        body,
      },
      data,
      tokens,
    };

    const response = await getMessaging().sendEachForMulticast(message);

    return {
      success: true,
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses.map((resp) => {
        if (resp.success) {
          return { success: true, messageId: resp.messageId };
        } else {
          return {
            success: false,
            error: resp.error?.message || "Unknown error",
          };
        }
      }),
    };
  } catch (error) {
    if (isDev()) {
      console.error("Error sending multicast notification:", error);
    }
    return {
      success: false,
      error: (error as Error).message ||
        "Failed to send multicast notification",
    };
  }
};

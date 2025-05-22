import dayjs from "dayjs";

export const generateReceiptNumber = () => {
  const receiptNumber = `NH${dayjs().format("YYMMDDHHmm")}`;
  return receiptNumber;
};

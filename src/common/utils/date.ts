import dayjs from "dayjs";

export const getCurrentDate = (format?: string) => {
  return dayjs().format(format);
}

export const getCurrentISODate = () => {
  return dayjs().toISOString();
}

export interface VatInfo {
  companyName?: string | null;
  taxCode?: string | null;
  email?: string | null;
  remark?: string | null;
}

export interface OrderItem {
  productId: string;
  productName: string;
  code: string;
  quantity: number;
  price: number;
}

// Type declaration for xlsx (SheetJS) — installed separately
// This makes dynamic import("xlsx") work for TypeScript
declare module "xlsx" {
  export function read(data: any, opts?: any): any;
  export function write(wb: any, opts?: any): any;
  export const utils: {
    sheet_to_json(sheet: any, opts?: any): any[];
    aoa_to_sheet(data: any[][], opts?: any): any;
    book_new(): any;
    book_append_sheet(wb: any, ws: any, name?: string): void;
    encode_cell(cell: { r: number; c: number }): string;
    decode_range(range: string): { s: { r: number; c: number }; e: { r: number; c: number } };
    [key: string]: any;
  };
  export const version: string;
}

import { OrderSide } from "./OrderSide";

export interface ITrade {
    market: string;
    price: number;
    amount: number;
    side: OrderSide;
    timestamp: number;
}
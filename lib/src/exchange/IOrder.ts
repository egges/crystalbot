import { OrderSide } from "./OrderSide";
import { OrderType } from "./OrderType";

export default interface IOrder {
    id: string;
    timestamp: number;
    timestampClosed?: number;
    status: string;
    market: string;
    type: OrderType;
    side: OrderSide;
    price: number;
    amount: number;
    fee: number;
    filled: number;
    remaining: number;
    autoCancel?: number;
    autoCancelAtFillPercentage?: number;
    autoCancelAtPriceLevel?: number;
    sticky?: boolean;
    metadata?: any;
}
/**
 * Enum indicating the current status of a position. These are the possibilities:
 * 
 * - Created: the position object has been created.
 * - Initialized: the position has been initialized with the requested settings.
 * - BuyOrderPlaced: the buy order has been placed.
 * - Entered: the position has been entered as is waiting until the buy order has been
 *   fulfilled. A trailing stop has been setup as well.
 * - Setup: the buy order has been completely or partially fulfilled and is closed. The
 *   limit orders for selling according to the settings have been setup.
 * - Completed: all limit orders related to the position have been closed.
 * - Cancelled: the position has been cancelled. This is possible if a limit buy order was
 *   placed on entry and it never traded more than the minimum amount needed to trade on the
 *   position.
 * - Left: the trailing stop loss triggered, which cancelled all remaining limit orders and
 *   created a market sell order for the remaining balance. 
 */
enum PositionStatus {
    Created = "created",
    Initialized = "initialized",
    Entered = "entered",
    Setup = "setup",
    Completed = "completed",
    Cancelled = "cancelled",
    Left = "left"
}

export default PositionStatus;
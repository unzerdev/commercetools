import type {
  CancelRequest,
  CaptureRequest,
  OperationResult,
  RefundPlanRequest,
  RefundPlanSlice,
  RefundRequest,
  StoreConfig,
} from '../../../domain';

/**
 * Capture, cancel and refund of an existing vendor payment. Every request carries the core-minted
 * `operationReference`, which the provider hands the vendor as the operation's idempotency key.
 */
export interface ModificationHandler {
  capture(cfg: StoreConfig, req: CaptureRequest): Promise<OperationResult>;

  cancel(cfg: StoreConfig, req: CancelRequest): Promise<OperationResult>;

  refund(cfg: StoreConfig, req: RefundRequest): Promise<OperationResult>;

  /** How many vendor operations a refund will be and for how much each, asked before any is performed. */
  planRefund(cfg: StoreConfig, req: RefundPlanRequest): Promise<RefundPlanSlice[]>;
}

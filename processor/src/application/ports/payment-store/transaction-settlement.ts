/** How the vendor answered a reserved leg. Settling is re-keying the leg to the vendor's operation id, so it is required. */
export interface TransactionSettlement {
  state: 'Pending' | 'Success';
  providerOperationId: string;
}

export interface TokenRefreshFailurePolicyInput {
  force: boolean;
  hasUsableExistingToken: boolean;
}

export function shouldReuseExistingTokenAfterRefreshFailure(
  input: TokenRefreshFailurePolicyInput,
): boolean {
  return !input.force && input.hasUsableExistingToken;
}

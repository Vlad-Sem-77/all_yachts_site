export async function sendPasswordResetEmail(
  _recipient: string,
  _resetUrl: string,
): Promise<void> {
  throw new Error("Password reset email integration is not connected.");
}

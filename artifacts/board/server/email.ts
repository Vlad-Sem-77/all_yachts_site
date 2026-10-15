export const passwordResetEmailEnabled = false;

export async function sendPasswordResetEmail(
  _recipient: string,
  _resetUrl: string,
): Promise<void> {
  throw new Error("Password reset email delivery is not configured.");
}

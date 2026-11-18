export function friendlyError(e: any): string {
  const code = String(e?.code ?? e?.message ?? '');
  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found'))
    return 'Incorrect email or password.';
  if (code.includes('invalid-email')) return 'Please enter a valid email address.';
  if (code.includes('too-many-requests')) return 'Too many attempts. Please wait and try again.';
  if (code.includes('api-key-not-valid') || code.includes('invalid-api-key'))
    return 'Firebase API key is invalid. Check src/app/core/firebase.ts.';
  if (code.includes('email-already-in-use')) return 'That email already has an account.';
  if (code.includes('weak-password')) return 'Password must be at least 6 characters.';
  if (code.includes('permission-denied'))
    return 'Firestore denied this action. Check your security rules and the account role.';
  if (code.includes('ACCOUNT_DISABLED'))
    return 'This account has been deactivated. Contact the administrator.';
  if (code.includes('requires-recent-login')) return 'Please sign in again, then retry.';
  if (code.includes('NO_PROFILE'))
    return 'This account has no valid role. Ask the administrator to set it up.';
  return e?.message ?? 'Something went wrong. Please try again.';
}

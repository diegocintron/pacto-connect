export function isTestMode(publishableKey: string): boolean {
  return publishableKey.startsWith('pk_test_');
}

export function keyMode(publishableKey: string): 'test' | 'live' | 'unknown' {
  if (publishableKey.startsWith('pk_test_')) {
    return 'test';
  }

  if (publishableKey.startsWith('pk_live_')) {
    return 'live';
  }

  return 'unknown';
}

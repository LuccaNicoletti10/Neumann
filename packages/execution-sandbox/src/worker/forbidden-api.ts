/**
 * Detect Node APIs the isolate does not grant.
 * Generic exceptions are not forbidden APIs — only require/import evidence is.
 */
export function detectForbiddenApi(source: string, errorMessage: string): boolean {
  if (/\brequire\s*\(/.test(source)) return true;
  if (/\bimport\s*\(/.test(source)) return true;
  if (errorMessage.includes('require is not defined')) return true;
  if (errorMessage.includes('ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING')) return true;
  return false;
}

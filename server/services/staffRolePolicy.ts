/** Prepare a restricted staff role without changing any account or shared system role. */
export function buildSalesmanPermissions(existingEffectivePermissions: string[]): string[] {
  const preserveRead = existingEffectivePermissions.filter(code =>
    /^(inventory[.:]view|reports?[.:].*(view|inventory|stock_ledger|purchase|sales|outstanding|payment|party_statement)|reports[.:]view)$/.test(code));
  return [...new Set([
    'sales:view','sales:create','sales:edit','sales:return:create','sales:return:post','purchase:view','purchase:create','purchase:edit','purchase:return:create','purchase:return:post','accounts:view','accounts:create','parties:view',
    'payment.receipt.view','payment.supplier.view','payment:receipt:post','payment:supplier:post','payment:allocation:create',
    ...preserveRead,
  ])].sort();
}

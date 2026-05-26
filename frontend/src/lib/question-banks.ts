import type { IQuestionBank } from "@/types";

export function getQuestionBankOwnerLabel(bank: IQuestionBank): string | null {
  const username = bank.owner_username?.trim();
  const fullName = bank.owner_full_name?.trim();

  if (fullName && username && fullName !== username) {
    return `${fullName} (@${username})`;
  }

  return fullName || username || null;
}

export function formatQuestionBankLabel(
  bank: IQuestionBank,
  options?: { showOwner?: boolean },
): string {
  if (!options?.showOwner) {
    return bank.name;
  }
  const owner = getQuestionBankOwnerLabel(bank);
  return owner ? `${bank.name} · ${owner}` : bank.name;
}

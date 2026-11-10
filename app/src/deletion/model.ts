export type DeletionIntent = { expected_version: number; expected_published: boolean };
export type DeletionReceipt = {
  project_id: string;
  deleted: true;
  deleted_at: string;
  receipt: string;
};

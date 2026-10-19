import type { AssignmentView } from "./models/number-assignment-model";

export type NumberSelectionAction = "assign" | "unassign" | "release";
export function numberSelectionActions(input: {
  ready: boolean;
  owned: boolean;
  organization: string | null | undefined;
  assignment?: AssignmentView | undefined;
  pending: boolean;
  releasing: boolean;
}) {
  const blocked =
    !input.ready ||
    input.pending ||
    input.releasing ||
    !!input.assignment?.active;
  const unassigned = !input.assignment && !input.organization;
  return {
    assign: !blocked && input.owned && unassigned,
    unassign:
      !blocked &&
      input.assignment?.status === "complete" &&
      !input.assignment.pendingCreate,
    release: !blocked && input.owned && unassigned,
  };
}

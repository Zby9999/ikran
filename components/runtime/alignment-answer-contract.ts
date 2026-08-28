/** Browser-side contract shared by the Workbench card and Runtime client. */
export type AnswerOption = {
  id: string;
  text: string;
};

export type AnswerSubmission =
  | { kind: "option"; optionId: string }
  | { kind: "custom"; text: string }
  /** Persisted pre-option cards retain the deprecated text/provenance path. */
  | { kind: "legacy"; text: string };

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Field, RecoveryCode } from "@/components/common";

describe("Field", () => {
  it("links the label, hint and error to the control", () => {
    const { rerender } = render(
      <Field label="Gebruikersnaam" hint="3 tot 32 tekens">
        {(p) => <input {...p} />}
      </Field>,
    );
    const input = screen.getByLabelText("Gebruikersnaam");
    expect(input).toHaveAccessibleDescription("3 tot 32 tekens");
    rerender(
      <Field label="Gebruikersnaam" error="Al in gebruik">
        {(p) => <input {...p} />}
      </Field>,
    );
    expect(screen.getByLabelText("Gebruikersnaam")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Gebruikersnaam")).toHaveAccessibleDescription("Al in gebruik");
  });

  it("shows a recovery code with a copy button", () => {
    render(<RecoveryCode code="ABCD-EFGH-JKLM-NPQR" />);
    expect(screen.getByText("ABCD-EFGH-JKLM-NPQR")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Kopiëren" })).toBeInTheDocument();
  });
});

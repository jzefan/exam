import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./alert-dialog";

describe("AlertDialog focus handling", () => {
  it("blurs the action trigger before invoking click handlers", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认操作</AlertDialogTitle>
            <AlertDialogDescription>请确认是否继续。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleClick}>确认</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const action = screen.getByRole("button", { name: "确认" });
    action.focus();
    expect(action).toHaveFocus();

    await user.click(action);

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(action).not.toHaveFocus();
  });

  it("blurs the cancel trigger before invoking click handlers", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();

    render(
      <AlertDialog open>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消操作</AlertDialogTitle>
            <AlertDialogDescription>请确认是否取消。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={handleClick}>取消</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>,
    );

    const cancel = screen.getByRole("button", { name: "取消" });
    cancel.focus();
    expect(cancel).toHaveFocus();

    await user.click(cancel);

    expect(handleClick).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveFocus();
  });
});

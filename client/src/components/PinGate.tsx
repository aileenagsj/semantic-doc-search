import { useState } from "react";
import { usePin } from "@/contexts/PinContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface PinGateProps {
  children: React.ReactNode;
  title?: string;
}

export default function PinGate({ children, title = "Restricted Access" }: PinGateProps) {
  const { adminPin, isUnlocked, unlock } = usePin();
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [isOpen, setIsOpen] = useState(!isUnlocked && !!adminPin);

  // If no PIN is configured, always show content
  if (!adminPin) {
    return <>{children}</>;
  }

  // If already unlocked, show content
  if (isUnlocked) {
    return <>{children}</>;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (unlock(pin)) {
      setIsOpen(false);
      setPin("");
      setError(false);
      toast.success("Unlocked");
    } else {
      setError(true);
      setPin("");
      toast.error("Incorrect PIN");
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-amber-600" />
              <DialogTitle>{title}</DialogTitle>
            </div>
            <DialogDescription>
              This page is restricted. Enter the PIN to continue.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Input
                type="password"
                inputMode="numeric"
                placeholder="Enter PIN"
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value);
                  setError(false);
                }}
                maxLength={6}
                autoFocus
                className={error ? "border-destructive focus-visible:ring-destructive" : ""}
              />
              {error && (
                <div className="flex items-center gap-1.5 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4" />
                  <span>Incorrect PIN</span>
                </div>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={pin.length === 0}>
              Unlock
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Blurred content behind the gate */}
      <div className={isUnlocked ? "" : "blur-sm pointer-events-none opacity-50"}>
        {children}
      </div>
    </>
  );
}

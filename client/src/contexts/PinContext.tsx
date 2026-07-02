import React, { createContext, useContext, useEffect, useState } from "react";

interface PinContextType {
  adminPin: string | null;
  isUnlocked: boolean;
  unlock: (pin: string) => boolean;
  lock: () => void;
}

const PinContext = createContext<PinContextType | undefined>(undefined);

export function PinProvider({ children }: { children: React.ReactNode }) {
  const adminPin = import.meta.env.VITE_ADMIN_PIN || null;
  const [isUnlocked, setIsUnlocked] = useState(false);

  // Load unlock state from localStorage on mount
  useEffect(() => {
    if (!adminPin) {
      setIsUnlocked(true); // No PIN configured, always unlocked
      return;
    }
    const stored = localStorage.getItem("admin_pin_unlocked");
    if (stored === "true") {
      setIsUnlocked(true);
    }
  }, [adminPin]);

  const unlock = (pin: string): boolean => {
    if (!adminPin) return true; // No PIN configured
    if (pin === adminPin) {
      setIsUnlocked(true);
      localStorage.setItem("admin_pin_unlocked", "true");
      return true;
    }
    return false;
  };

  const lock = () => {
    setIsUnlocked(false);
    localStorage.removeItem("admin_pin_unlocked");
  };

  return (
    <PinContext.Provider value={{ adminPin, isUnlocked, unlock, lock }}>
      {children}
    </PinContext.Provider>
  );
}

export function usePin() {
  const ctx = useContext(PinContext);
  if (!ctx) {
    throw new Error("usePin must be used within PinProvider");
  }
  return ctx;
}

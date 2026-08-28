export interface IosSimulator {
  udid: string;
  name: string;
  state: "Booted" | "Shutdown" | "Unknown";
  runtime: string;
}

export interface IosOnboardingPlan {
  target: "simulator" | "real-device";
  steps: string[];
}

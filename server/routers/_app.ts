import { router } from "../trpc";
import { accountRouter } from "./account";
import { holidayRouter } from "./holiday";
import { particularRouter } from "./particular";
import { forecastRouter } from "./forecast";
import { categoryRouter } from "./category";
import { inviteRouter } from "./invite";
import { debtRouter } from "./debt";
import { preferencesRouter } from "./preferences";

export const appRouter = router({
  account: accountRouter,
  holiday: holidayRouter,
  particular: particularRouter,
  forecast: forecastRouter,
  category: categoryRouter,
  invite: inviteRouter,
  debt: debtRouter,
  preferences: preferencesRouter,
});

export type AppRouter = typeof appRouter;

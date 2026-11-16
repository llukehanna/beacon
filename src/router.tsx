import { Suspense, lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import RouteError from "@/RouteError";
import Titled from "@/Titled";
import Loading from "@/components/Loading";
import NotFound from "@/components/NotFound";
import Home from "@/home/HomePage";
import AppShell from "@/shell/AppShell";

// Home is the start-of-day page and stays in the initial bundle. Every other
// surface is split into its own chunk and fetched on first navigation.
const About = lazy(() => import("@/about/AboutPage"));
const Accuracy = lazy(() => import("@/accuracy/AccuracyPage"));
const Compliance = lazy(() => import("@/compliance/CompliancePage"));
const Desk = lazy(() => import("@/desk/firmDesk/DeskPage"));
const MandatePage = lazy(() => import("@/mandates/MandatePage"));
const Pipeline = lazy(() => import("@/pipeline/PipelinePage"));
const Review = lazy(() => import("@/review/ReviewPage"));
const Rules = lazy(() => import("@/rules/RulesPage"));
const SearchPage = lazy(() => import("@/mandates/SearchPage"));
const TearSheet = lazy(() => import("@/tearsheet/TearSheetPage"));
const Trust = lazy(() => import("@/about/TrustPage"));

export const router = createBrowserRouter(
  [
    {
      // One layout route: the shell (sidebar, top bar, status bar) stays mounted while the
      // screens below it come and go.
      element: <AppShell />,
      children: [
        {
          // Start-of-day operations page. Every card and number on it links to
          // the surface that does the work; it is not a stats dashboard.
          errorElement: <RouteError />,
          path: "/",
          element: (
            <Titled title="Beacon — Acquisition target sourcing">
              <Home />
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/desk",
          element: (
            <Titled title="Desk — Beacon">
              <Suspense fallback={<Loading />}>
                <Desk />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/pipeline",
          element: (
            <Titled title="Pipeline — Beacon">
              <Suspense fallback={<Loading />}>
                <Pipeline />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/review",
          element: (
            <Titled title="Review — Beacon">
              <Suspense fallback={<Loading />}>
                <Review />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/rules",
          element: (
            <Titled title="Rules — Beacon">
              <Suspense fallback={<Loading />}>
                <Rules />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/accuracy",
          element: (
            <Titled title="Accuracy — Beacon">
              <Suspense fallback={<Loading />}>
                <Accuracy />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/mandate",
          element: (
            <Titled title="Mandates — Beacon">
              <Suspense fallback={<Loading />}>
                <MandatePage />
              </Suspense>
            </Titled>
          ),
        },
        {
          // "Interpret & run search" surface — turns a mandate's intent into
          // a Search (geographies / industries / seeds / exclusions / breadth
          // → the run-search action). Routes to /desk?search=<id> on completion.
          errorElement: <RouteError />,
          path: "/search/:mandateId",
          element: (
            <Titled title="Run search — Beacon">
              <Suspense fallback={<Loading />}>
                <SearchPage />
              </Suspense>
            </Titled>
          ),
        },
        {
          // One printable page per firm. The print stylesheet drops the shell, so "Print / Save
          // as PDF" produces the sheet alone.
          errorElement: <RouteError />,
          path: "/firm/:firmId/tear-sheet",
          element: (
            <Titled title="Tear sheet — Beacon">
              <Suspense fallback={<Loading />}>
                <TearSheet />
              </Suspense>
            </Titled>
          ),
        },
        {
          // What Beacon is, and what it does with data and models. Linked from the sidebar footer
          // and the home intro, not part of the go-to keys.
          errorElement: <RouteError />,
          path: "/about",
          element: (
            <Titled title="About — Beacon">
              <Suspense fallback={<Loading />}>
                <About />
              </Suspense>
            </Titled>
          ),
        },
        {
          errorElement: <RouteError />,
          path: "/trust",
          element: (
            <Titled title="Trust and security — Beacon">
              <Suspense fallback={<Loading />}>
                <Trust />
              </Suspense>
            </Titled>
          ),
        },
        {
          // Restricted firms and the access log: compliance persona only (the server enforces it;
          // any other persona sees an empty state). Linked from the sidebar for that persona alone.
          errorElement: <RouteError />,
          path: "/compliance",
          element: (
            <Titled title="Information barriers — Beacon">
              <Suspense fallback={<Loading />}>
                <Compliance />
              </Suspense>
            </Titled>
          ),
        },
        {
          // Any path no route above matches, inside the shell so navigation stays at hand.
          errorElement: <RouteError />,
          path: "*",
          element: (
            <Titled title="Not found — Beacon">
              <NotFound />
            </Titled>
          ),
        },
      ],
    },
  ],
  { basename: import.meta.env.BASE_URL },
);

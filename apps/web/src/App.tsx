import { lazy, Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { useMe, useSignedIn, useSignOut } from './auth/session';
import { NoAccess, Shell } from './layout/Shell';
import { SignIn } from './pages/SignIn';
import { Button } from './ui/controls';
import { ErrorBox, Loading } from './ui/feedback';

const LiveDispatch = lazy(() => import('./dispatch/LiveDispatch'));
const PhoneOrder = lazy(() => import('./orders/PhoneOrder'));
const RidesList = lazy(() => import('./rides/RidesList'));
const RidePage = lazy(() => import('./rides/RidePage'));
const DriversList = lazy(() => import('./drivers/DriversList'));
const DriverPage = lazy(() => import('./drivers/DriverPage'));
const SosQueue = lazy(() => import('./safety/SosQueue'));
const Taxes = lazy(() => import('./billing/Taxes'));
const Tariffs = lazy(() => import('./settings/Tariffs'));
const Cities = lazy(() => import('./settings/Cities'));
const Settings = lazy(() => import('./settings/Settings'));
const RouteFares = lazy(() => import('./settings/RouteFares'));
const Account = lazy(() => import('./pages/Account'));
const IntercityBoard = lazy(() => import('./intercity/IntercityBoard'));
const TripPage = lazy(() => import('./intercity/TripPage'));
const Payments = lazy(() => import('./billing/Payments'));
const Complaints = lazy(() => import('./support/Complaints'));
const Ratings = lazy(() => import('./support/Ratings'));
const Appeals = lazy(() => import('./drivers/Appeals'));
const Fiscal = lazy(() => import('./operations/Fiscal'));
const Outbox = lazy(() => import('./operations/Outbox'));

export function App() {
  const signedIn = useSignedIn();
  const me = useMe(signedIn);
  const signOut = useSignOut();

  if (!signedIn) return <SignIn />;
  if (me.isPending) return <Loading text="Hisob yuklanmoqda…" />;
  if (me.error) {
    return (
      <main className="center-page">
        <ErrorBox error={me.error} onRetry={() => void me.refetch()} />
        <Button variant="ghost" onClick={() => void signOut()}>
          Chiqish
        </Button>
      </main>
    );
  }
  if (!me.data.isAdmin) return <NoAccess me={me.data} />;

  return (
    <Routes>
      <Route element={<Shell me={me.data} />}>
        {/* pages load lazily inside the frame: the alarm strip stays while they do */}
        <Route
          element={
            <Suspense fallback={<Loading />}>
              <Outlet />
            </Suspense>
          }
        >
          <Route path="/dispatch" element={<LiveDispatch />} />
          <Route path="/phone-order" element={<PhoneOrder />} />
          <Route path="/rides" element={<RidesList />} />
          <Route path="/rides/:rideId" element={<RidePage />} />
          <Route path="/drivers" element={<DriversList />} />
          <Route path="/drivers/:driverId" element={<DriverPage />} />
          <Route path="/intercity" element={<IntercityBoard />} />
          <Route path="/intercity/:tripId" element={<TripPage />} />
          <Route path="/appeals" element={<Appeals />} />
          <Route path="/ratings" element={<Ratings />} />
          <Route path="/sos" element={<SosQueue />} />
          <Route path="/complaints" element={<Complaints />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/fiscal" element={<Fiscal />} />
          <Route path="/outbox" element={<Outbox />} />
          <Route path="/taxes" element={<Taxes />} />
          <Route path="/tariffs" element={<Tariffs />} />
          <Route path="/cities" element={<Cities />} />
          <Route path="/routes" element={<RouteFares />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/account" element={<Account me={me.data} />} />
          <Route path="*" element={<Navigate to="/dispatch" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

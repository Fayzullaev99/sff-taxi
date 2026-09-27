import {
  Bell,
  BellOff,
  BusFront,
  Calculator,
  CircleUserRound,
  ClipboardList,
  LogOut,
  Map as MapIcon,
  Menu as MenuIcon,
  MessageSquareWarning,
  PhoneCall,
  Radar,
  Receipt,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Siren,
  Star,
  Users,
  Volume2,
  VolumeX,
  Wallet,
  Wifi,
  WifiOff,
  Workflow,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { useAppeals, useComplaints, useDrivers, useRefunds } from '../api/queries';
import { type StreamState, useRealtime } from '../api/realtime';
import type { Me } from '../api/types';
import { useSignOut } from '../auth/session';
import { useDispatchAlarms } from '../dispatch/alarms';
import { notificationsSupported } from '../lib/alert';
import { formatPhone } from '../lib/phone';
import { Button } from '../ui/controls';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

/** The sections of the panel, grouped the way a dispatch shift uses them. */
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Dispetcherlik',
    items: [
      { to: '/dispatch', label: 'Jonli xarita', icon: <Radar size={18} /> },
      { to: '/phone-order', label: 'Telefon buyurtma', icon: <PhoneCall size={18} /> },
      { to: '/rides', label: 'Safarlar', icon: <ClipboardList size={18} /> },
      { to: '/intercity', label: 'Shaharlararo', icon: <BusFront size={18} /> },
    ],
  },
  {
    title: 'Xavfsizlik va yordam',
    items: [
      { to: '/sos', label: 'SOS', icon: <Siren size={18} /> },
      { to: '/complaints', label: 'Shikoyatlar', icon: <MessageSquareWarning size={18} /> },
      { to: '/ratings', label: 'Baholar', icon: <Star size={18} /> },
    ],
  },
  {
    title: 'Haydovchilar',
    items: [
      { to: '/drivers', label: 'Haydovchilar', icon: <Users size={18} /> },
      { to: '/appeals', label: 'Murojaatlar', icon: <Scale size={18} /> },
    ],
  },
  {
    title: 'Moliya',
    items: [
      { to: '/payments', label: 'To‘lovlar', icon: <Wallet size={18} /> },
      { to: '/taxes', label: 'Soliq hisoboti', icon: <Receipt size={18} /> },
      { to: '/fiscal', label: 'Fiskal cheklar', icon: <ScrollText size={18} /> },
    ],
  },
  {
    title: 'Tizim',
    items: [
      { to: '/tariffs', label: 'Tariflar', icon: <Calculator size={18} /> },
      { to: '/cities', label: 'Shaharlar', icon: <MapIcon size={18} /> },
      { to: '/settings', label: 'Sozlamalar', icon: <Settings size={18} /> },
      { to: '/outbox', label: 'Bajarilmagan amallar', icon: <Workflow size={18} /> },
    ],
  },
];

/** Counts next to the sections: red ones need someone now, blue ones are queues. */
const INFO_COUNTS = new Set(['/drivers', '/appeals', '/complaints', '/payments']);

function NotificationButton() {
  const [permission, setPermission] = useState(() =>
    notificationsSupported() ? Notification.permission : 'denied',
  );
  if (!notificationsSupported() || permission === 'granted') return null;
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={permission === 'denied' ? <BellOff size={16} /> : <Bell size={16} />}
      disabled={permission === 'denied'}
      title={
        permission === 'denied'
          ? 'Bildirishnomalar brauzer sozlamalarida bloklangan'
          : 'Haydovchi topilmagan buyurtmalar va SOS haqida brauzer bildirishnomasi'
      }
      onClick={() => void Notification.requestPermission().then(setPermission)}
    >
      {permission === 'denied' ? 'Bildirishnomalar bloklangan' : 'Bildirishnomalarni yoqish'}
    </Button>
  );
}

function StreamBadge({ state }: { state: StreamState }) {
  const label =
    state === 'open'
      ? 'Jonli aloqa bor'
      : state === 'connecting'
        ? 'Ulanmoqda…'
        : 'Jonli aloqa uzildi — qayta ulanmoqda';
  return (
    <span className={`stream-state is-${state}`} role="status" title={label}>
      {state === 'down' ? <WifiOff size={15} aria-hidden /> : <Wifi size={15} aria-hidden />}
      <span>{label}</span>
    </span>
  );
}

/**
 * The operator frame: navigation, the realtime stream, and the alarm strip for rides that
 * found no driver and SOS signals, on every page.
 */
export function Shell({ me }: { me: Me }) {
  const signOut = useSignOut();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const stream = useRealtime(true);
  const alarms = useDispatchAlarms();
  const pending = useDrivers('pending', '', 60_000);
  const appeals = useAppeals('open', 60_000);
  const complaints = useComplaints({ status: 'open' }, 60_000);
  const refunds = useRefunds();

  useEffect(() => setNavOpen(false), [location.pathname]);

  const counts: Record<string, number> = {
    '/dispatch': alarms.waiting.length,
    '/sos': alarms.openSos.length,
    '/drivers': pending.data?.length ?? 0,
    '/appeals': appeals.data?.length ?? 0,
    // new complaints nobody answered yet (a full page reads as 100+)
    '/complaints': complaints.data?.pages[0]?.items.length ?? 0,
    '/payments': refunds.data?.length ?? 0,
  };
  const firstWaiting = alarms.waiting[0];

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <header className="topbar">
        <button
          type="button"
          className="icon-btn"
          aria-label={navOpen ? 'Menyuni yopish' : 'Menyuni ochish'}
          aria-expanded={navOpen}
          aria-controls="sidebar"
          onClick={() => setNavOpen((o) => !o)}
        >
          {navOpen ? <X size={22} /> : <MenuIcon size={22} />}
        </button>
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" width={28} height={28} />
          <strong>SFF Taxi</strong>
        </Link>
        {alarms.count > 0 && (
          <span className="nav-count" aria-label={`${alarms.count} ta ogohlantirish`}>
            {alarms.count}
          </span>
        )}
      </header>
      <aside className="sidebar" id="sidebar">
        <Link to="/" className="brand">
          <img src="/icon.svg" alt="" width={34} height={34} />
          <div>
            <strong>SFF Taxi</strong>
            <span>Dispetcher paneli</span>
          </div>
        </Link>
        <nav aria-label="Bo‘limlar">
          {NAV.map((group) => (
            <div key={group.title} className="nav-group">
              <span className="nav-group-title">{group.title}</span>
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} className="nav-link">
                  {item.icon}
                  <span>{item.label}</span>
                  {(counts[item.to] ?? 0) > 0 && (
                    <span
                      className={`nav-count${INFO_COUNTS.has(item.to) ? ' is-info' : ''}`}
                      aria-label={`${counts[item.to]} ta kutmoqda`}
                    >
                      {counts[item.to]! >= 100 ? '99+' : counts[item.to]}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="me">
            <ShieldCheck size={16} aria-label="Operator" />
            <div>
              <strong>{me.fullName ?? formatPhone(me.phone)}</strong>
              {me.fullName && <span>{formatPhone(me.phone)}</span>}
            </div>
          </div>
          <NavLink to="/account" className="nav-link">
            <CircleUserRound size={18} />
            <span>Hisob</span>
          </NavLink>
          <Button
            variant="ghost"
            size="sm"
            icon={<LogOut size={16} />}
            onClick={() => void signOut()}
          >
            Chiqish
          </Button>
        </div>
      </aside>
      <div className="backdrop" onClick={() => setNavOpen(false)} aria-hidden />
      <main className="content">
        <div className="workspace-bar">
          <StreamBadge state={stream} />
          <div className="workspace-tools">
            <NotificationButton />
            <Button
              size="sm"
              variant="ghost"
              icon={alarms.soundOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
              aria-pressed={alarms.soundOn}
              onClick={alarms.toggleSound}
            >
              {alarms.soundOn ? 'Ovoz yoqilgan' : 'Ovoz o‘chirilgan'}
            </Button>
          </div>
        </div>
        {alarms.count > 0 && (
          <div className="alarm-strip" role="alert">
            <Siren size={18} aria-hidden className={alarms.acknowledged ? undefined : 'ringing'} />
            <span>
              <strong>Diqqat:</strong>{' '}
              {[
                alarms.openSos.length > 0 && `${alarms.openSos.length} ta ochiq SOS`,
                alarms.waiting.length > 0 &&
                  `${alarms.waiting.length} ta buyurtmaga haydovchi topilmadi`,
              ]
                .filter(Boolean)
                .join(', ')}
            </span>
            {alarms.soundOn && !alarms.audioUnlocked && (
              <span className="muted">— ovozli signal uchun sahifaning istalgan joyini bosing</span>
            )}
            <span className="strip-actions">
              {!alarms.acknowledged && (
                <button type="button" className="btn btn-sm btn-ghost" onClick={alarms.acknowledge}>
                  Ko‘rdim
                </button>
              )}
              {alarms.openSos.length > 0 && location.pathname !== '/sos' && (
                <Link to="/sos" className="btn btn-sm">
                  SOS ro‘yxati
                </Link>
              )}
              {firstWaiting && (
                <Link to={`/dispatch?ride=${firstWaiting.id}`} className="btn btn-sm">
                  #{firstWaiting.number} ni tayinlash
                </Link>
              )}
            </span>
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}

export function NoAccess({ me }: { me: Me }) {
  const signOut = useSignOut();
  return (
    <main className="center-page">
      <div className="card narrow">
        <h1>Panelga kirish huquqi yo‘q</h1>
        <p>
          <strong>{formatPhone(me.phone)}</strong> raqami dispetcher (operator) sifatida ro‘yxatdan
          o‘tmagan.
        </p>
        <p className="muted">
          Operator raqamlari serverdagi ADMIN_PHONES sozlamasida beriladi. Rahbariyatga murojaat
          qiling.
        </p>
        <Button variant="primary" icon={<LogOut size={16} />} onClick={() => void signOut()}>
          Boshqa raqam bilan kirish
        </Button>
      </div>
    </main>
  );
}

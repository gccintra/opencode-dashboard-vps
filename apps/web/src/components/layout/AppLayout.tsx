import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import EmergencyTerminal from '../EmergencyTerminal/EmergencyTerminal';
import ConnectionStatus from '../ConnectionStatus/ConnectionStatus';

export default function AppLayout() {
  return (
    <div className="flex h-screen h-dvh bg-[#0a0a0f]">
      <Sidebar />
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Top bar with connection status and emergency terminal button */}
        <div className="flex shrink-0 items-center justify-end gap-[8px] border-b border-[rgba(255,255,255,0.08)] pl-[60px] pr-[16px] py-[8px] lg:pl-[16px]">
          <ConnectionStatus />
          <EmergencyTerminal />
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

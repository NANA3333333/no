import AdminDashboard from './components/AdminDashboard';
import CityLog from './plugins/city/CityLog';
import { Shield, Activity } from 'lucide-react';

// Centralised registry for Frontend DLCs
export const plugins = [
    {
        id: 'admin',
        name_en: 'Admin Dashboard',
        name_zh: '管理后台',
        icon: Shield,
        component: AdminDashboard,
        color: 'var(--accent-color)',
        condition: (userProfile) => userProfile?.username === 'Nana',
        position: 'bottom' // 'top' or 'bottom' nav group
    },
    {
        id: 'city',
        name_en: 'The City',
        name_zh: '商业街',
        icon: Activity,
        component: CityLog,
        color: '#ff9800',
        position: 'top' // shows up with Chats, Contacts, Moments
    }
];

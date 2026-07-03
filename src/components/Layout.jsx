import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { BookOpen, Library, Settings, Tv } from 'lucide-react';
import { useStore } from '../store';
import { isLocalEngineDisabled, RUNTIME_CONFIG_CHANGED } from '../lib/runtimeConfig';
import styles from './Layout.module.css';

export function Layout() {
    const { apiKey } = useStore();
    const [localEngineDisabled, setLocalEngineDisabled] = React.useState(isLocalEngineDisabled);
    const location = useLocation();
    
    const isPlayerPage = location.pathname.startsWith('/player');

    React.useEffect(() => {
        const handleConfigChange = () => {
            setLocalEngineDisabled(isLocalEngineDisabled());
        };

        window.addEventListener(RUNTIME_CONFIG_CHANGED, handleConfigChange);
        return () => window.removeEventListener(RUNTIME_CONFIG_CHANGED, handleConfigChange);
    }, []);

    const needsGeminiKey = localEngineDisabled && !apiKey;

    return (
        <div className={styles.appShell}>
            {/* Draggable Area */}
            <div className={styles.dragRegion} />

            <aside className={`${styles.sidebar} ${isPlayerPage ? styles.sidebarHiddenOnMobile : ''}`}>
                <div className={styles.logo}>
                    <Tv className={styles.logoIcon} />
                    <span>PodFluent</span>
                </div>

                <nav className={styles.nav}>
                    <NavLink
                        to="/"
                        className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                    >
                        <Library size={20} />
                        <span>Library</span>
                    </NavLink>

                    <NavLink
                        to="/vocabulary"
                        className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                    >
                        <BookOpen size={20} />
                        <span>Vocabulary</span>
                    </NavLink>

                    <div className={styles.spacer} />

                    <NavLink
                        to="/settings"
                        className={({ isActive }) => `${styles.navItem} ${isActive ? styles.active : ''}`}
                    >
                        <Settings size={20} />
                        <span>Settings</span>
                        {needsGeminiKey && <div className={styles.alertDot} />}
                    </NavLink>
                </nav >
            </aside >

            <main className={styles.main}>
                <Outlet />
            </main>
        </div >
    );
}

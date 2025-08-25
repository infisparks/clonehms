'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { 
  Menu, 
  X, 
  LayoutDashboard, 
  Users, 
  FileText, 
  Calendar, 
  Bed, 
  Skull, 
  LogOut,
  Hospital,
  ChevronDown,
  ChevronRight,
  UserPlus,
  Settings,
  Activity,
  ClipboardList,
  UserCheck,
  Building,
  Stethoscope
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { supabase } from '@/lib/supabase'
import { useUserRole } from '../userrole';

const Sidebar = () => {
  const { role, loading } = useUserRole();
  const [isOpen, setIsOpen] = useState(false)
  const [expandedMenus, setExpandedMenus] = useState<string[]>([])
  const pathname = usePathname()
  const router = useRouter()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
        <span className="ml-4 text-blue-700 font-semibold">Loading...</span>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="text-red-600 font-semibold">No access: User role not found.</span>
      </div>
    );
  }

  const toggleSidebar = () => setIsOpen(!isOpen)

  const toggleMenu = (menuName: string) => {
    setExpandedMenus(prev => 
      prev.includes(menuName) 
        ? prev.filter(item => item !== menuName)
        : [...prev, menuName]
    )
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
  }

  type MenuItem = {
    title: string;
    icon: React.ElementType;
    href?: string;
    submenu: { title: string; href: string }[];
  };
  let menuItems: MenuItem[] = [];
  if (role === 'admin') {
    menuItems = [
      {
        title: 'Dashboard',
        icon: LayoutDashboard,
        href: '/dashboard',
        submenu: [],
      },
      {
        title: 'Manage Admin',
        icon: Users,
        submenu: [
          { title: 'june data backup', href: '/backup' },

          { title: 'OPD Admin', href: '/admin/opd-admin' },
          { title: 'IPD Admin', href: '/admin/ipd-admin' },
          { title: 'Patient Admin', href: '/admin/patient-admin' },
          { title: 'DPR', href: '/admin/dpr' },
          { title: 'OT', href: '/admin/ot' },
          { title: 'Daily Collection', href: '/amount' },
          // { title: 'Add Service', href: '/dashboard/add-service' },
        ]
      },
      {
        title: 'OPD',
        icon: Stethoscope,
        submenu: [
          { title: 'Appointment', href: '/opd/appointment' },
          { title: 'OPD List', href: '/opd/list' },
          { title: 'OPD List Prescription', href: '/opd/list/opdlistprescripitono' },
          { title: 'Add Doctor', href: '/opd/add-doctor' },
        ]
      },
      {
        title: 'IPD',
        icon: Bed,
        submenu: [
          { title: 'IPD Appointment', href: '/ipd/appointment' },
          { title: 'IPD Management', href: '/ipd/management' },
          { title: 'BED Management', href: '/ipd/bed-management' },
          { title: 'Add Doctor', href: '/ipd/add-doctor' },
          { title: 'Today  Amount', href: '/amount' },
        ]
      },
    ];
  } else if (role === 'opd-ipd') {
    menuItems = [
      {
        title: 'OPD',
        icon: Stethoscope,
        submenu: [
          { title: 'Appointment', href: '/opd/appointment' },
          { title: 'OPD List', href: '/opd/list' },
          { title: 'OPD List Prescription', href: '/opd/list/opdlistprescripitono' },
          { title: 'Add Doctor', href: '/opd/add-doctor' },
        ]
      },
      {
        title: 'IPD',
        icon: Bed,
        submenu: [
          { title: 'IPD Appointment', href: '/ipd/appointment' },
          { title: 'IPD Management', href: '/ipd/management' },
          { title: 'BED Management', href: '/ipd/bed-management' },
          { title: 'Add Doctor', href: '/ipd/add-doctor' },
          { title: 'Today  Amount', href: '/amount' },
        ]
      },
    ];
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={toggleSidebar}
        />
      )}

      {/* Mobile toggle button */}
      <Button
        onClick={toggleSidebar}
        variant="outline"
        size="sm"
        className="fixed top-4 left-4 z-50 lg:hidden bg-white shadow-md"
      >
        <Menu className="h-4 w-4" />
      </Button>

      {/* Sidebar */}
      <div className={cn(
        "fixed left-0 top-0 h-full bg-white border-r border-gray-200 z-50 transition-all duration-300 ease-in-out shadow-lg",
        isOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        "w-72"
      )}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-blue-100 rounded-xl shadow-sm">
              <Hospital className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">INFICARE</h2>
              <p className="text-sm text-gray-600">Hospital Management</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className="lg:hidden hover:bg-blue-100"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 h-[calc(100vh-140px)]">
          <nav className="py-4">
            <ul className="space-y-1 px-3">
              {menuItems.map((item) => (
                <li key={item.title}>
                  {item.submenu.length > 0 ? (
                    <div>
                      <button
                        onClick={() => toggleMenu(item.title)}
                        className={cn(
                          "w-full flex items-center justify-between px-3 py-3 text-sm font-medium rounded-xl transition-all duration-200",
                          "hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 text-gray-700 hover:text-blue-700",
                          "group"
                        )}
                      >
                        <div className="flex items-center space-x-3">
                          <item.icon className="h-5 w-5 transition-colors group-hover:text-blue-600" />
                          <span>{item.title}</span>
                        </div>
                        <div className={cn(
                          "transition-transform duration-200",
                          expandedMenus.includes(item.title) ? "rotate-90" : ""
                        )}>
                          <ChevronRight className="h-4 w-4" />
                        </div>
                      </button>
                      <div className={cn(
                        "overflow-hidden transition-all duration-300 ease-in-out",
                        expandedMenus.includes(item.title) ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                      )}>
                        {Array.isArray(item.submenu) && (
                          <ul className="mt-2 space-y-1 ml-6 border-l-2 border-gray-100">
                            {(item.submenu as { title: string; href: string }[]).map((subItem) => (
                              <li key={subItem.title}>
                                <Link
                                  href={(subItem.href ?? '/') as string}
                                  className={cn(
                                    "block px-4 py-2 text-sm rounded-lg transition-all duration-200 ml-2",
                                    pathname === subItem.href
                                      ? "bg-gradient-to-r from-blue-100 to-indigo-100 text-blue-700 font-medium shadow-sm"
                                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                                  )}
                                >
                                  {subItem.title}
                                </Link>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  ) : (
                    <Link
                      href={item.href ?? '/'}
                      className={cn(
                        "flex items-center space-x-3 px-3 py-3 text-sm font-medium rounded-xl transition-all duration-200",
                        pathname === item.href
                          ? "bg-gradient-to-r from-blue-100 to-indigo-100 text-blue-700 shadow-sm"
                          : "text-gray-700 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 hover:text-blue-700"
                      )}
                    >
                      <item.icon className="h-5 w-5" />
                      <span>{item.title}</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        </ScrollArea>

        {/* Logout */}
        <div className="border-t border-gray-200 p-4 bg-gradient-to-r from-gray-50 to-gray-100">
          <Button
            onClick={handleLogout}
            variant="ghost"
            className="w-full justify-start text-red-600 hover:text-red-700 hover:bg-red-50 rounded-xl transition-all duration-200"
          >
            <LogOut className="h-5 w-5 mr-3" />
            Logout
          </Button>
        </div>
      </div>

      {/* Main content spacer for desktop */}
      <div className="hidden lg:block w-72 flex-shrink-0" />
    </>
  )
}

export default Sidebar
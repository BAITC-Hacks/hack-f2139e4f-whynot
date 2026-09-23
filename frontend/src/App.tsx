import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Navigate, Route, Routes, Link, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { useRole } from './context/RoleContext';
import { NewTaskPage } from './pages/NewTaskPage';
import { QuestionsPage } from './pages/QuestionsPage';
import { EditorPage } from './pages/EditorPage';
import { BusinessTasksPage } from './pages/BusinessTasksPage';
import { CatalogPage } from './pages/CatalogPage';
import { TaskDetailPage } from './pages/TaskDetailPage';
import { ProposalsPage } from './pages/ProposalsPage';
import { TeamProfilePage, TeamProposalsPage, TeamProgressPage } from './pages/TeamPages';
import { Button, EmptyState, Skeleton } from './components/ui';
import { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage } from './pages/AuthPages';
import { BusinessProfilePage, BusinessHistoryPage, StudentHistoryPage } from './pages/ProfileHistoryPages';
import { StudentProfilePage } from './pages/StudentProfilePage';
function RoleGuard({role,children}:{role:'business'|'student';children:ReactNode}){const context=useRole();const location=useLocation();if(context.loading)return <div className="page"><Skeleton/></div>;if(!context.actor)return <Navigate to="/login" state={{from:location.pathname+location.search}} replace/>;return context.role===role?<>{children}</>:<Navigate to="/catalog" replace/>}
export class ErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return {failed:true}}componentDidCatch(error:Error,_info:ErrorInfo){console.error('Ошибка интерфейса:',error)}render(){return this.state.failed?<main className="page"><EmptyState title="Не удалось отобразить страницу" description="Перезагрузите приложение. Сохранённые на сервере данные останутся доступными." action={<Button onClick={()=>window.location.reload()}>Перезагрузить</Button>}/></main>:this.props.children}}
export function App(){const {actor}=useRole();return <Routes key={actor?.id||'loading'}><Route element={<Layout/>}>
 <Route index element={<Navigate to="/catalog" replace/>}/>
 <Route path="catalog" element={<CatalogPage/>}/>
 <Route path="login" element={<LoginPage/>}/>
 <Route path="register" element={<RegisterPage/>}/>
 <Route path="forgot-password" element={<ForgotPasswordPage/>}/>
 <Route path="reset-password" element={<ResetPasswordPage/>}/>
 <Route path="new" element={<RoleGuard role="business"><NewTaskPage/></RoleGuard>}/>
 <Route path="new/questions" element={<RoleGuard role="business"><QuestionsPage/></RoleGuard>}/>
 <Route path="tasks/:id/edit" element={<RoleGuard role="business"><EditorPage/></RoleGuard>}/>
 <Route path="tasks/:id" element={<TaskDetailPage/>}/>
 <Route path="tasks/:id/proposals" element={<RoleGuard role="business"><ProposalsPage/></RoleGuard>}/>
 <Route path="business/tasks" element={<RoleGuard role="business"><BusinessTasksPage/></RoleGuard>}/>
 <Route path="business/profile" element={<RoleGuard role="business"><BusinessProfilePage/></RoleGuard>}/>
 <Route path="business/history" element={<RoleGuard role="business"><BusinessHistoryPage/></RoleGuard>}/>
 <Route path="student/history" element={<RoleGuard role="student"><StudentHistoryPage/></RoleGuard>}/>
 <Route path="student/profile" element={<RoleGuard role="student"><StudentProfilePage/></RoleGuard>}/>
 <Route path="recommendations" element={<RoleGuard role="student"><CatalogPage recommendations/></RoleGuard>}/>
 <Route path="team/profile" element={<RoleGuard role="student"><TeamProfilePage/></RoleGuard>}/>
 <Route path="team/proposals" element={<RoleGuard role="student"><TeamProposalsPage/></RoleGuard>}/>
 <Route path="team/progress" element={<RoleGuard role="student"><TeamProgressPage/></RoleGuard>}/>
 <Route path="*" element={<EmptyState title="Такой страницы нет" description="Вернитесь в каталог, чтобы найти задачу." action={<Link className="button button-primary" to="/catalog">В каталог</Link>}/>}/>
 </Route></Routes>}

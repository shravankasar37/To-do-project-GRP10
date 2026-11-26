import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';

export type Permission = 'view_tasks' | 'view_users';
interface SessionUser { permissions?: Permission[]; portal?: 'user' | 'admin'; id: number; name: string; email: string; role: 'user' | 'admin' }
export interface User extends SessionUser { is_active: boolean }
export interface Draft {
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  status: 'pending' | 'completed';
  due_date: string | null;
}
export interface Task extends Draft { id: number; user_id: number }
interface Session { token: string; user: SessionUser }
const sessionKey = 'grp10.todo.session';

function validSession(value: Session | null): value is Session {
  return typeof value?.token === 'string' && value.token.length > 0
    && Number.isInteger(value.user?.id) && typeof value.user.name === 'string'
    && typeof value.user.email === 'string' && ['user', 'admin'].includes(value.user.role);
}

@Injectable({ providedIn: 'root' })
export class Api {
  private http = inject(HttpClient);
  session: Session | null = this.restoreSession();

  private restoreSession(): Session | null {
    try {
      const saved = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null');
      if (validSession(saved)) return saved;
      sessionStorage.removeItem(sessionKey);
    } catch { /* Missing or inaccessible storage starts a signed-out session. */ }
    return null;
  }

  logout() {
    this.session = null;
    try { sessionStorage.removeItem(sessionKey); }
    catch { /* Storage can be disabled by the browser. */ }
  }

  register(name: string, email: string, password: string) {
    return firstValueFrom(this.http.post('/api/auth/register', {name, email, password}));
  }

  async login(email: string, password: string, portal: SessionUser['role']) {
    const result = await firstValueFrom(this.http.post<Session>('/api/auth/login', {email, password, portal}));
    if (!validSession(result)) {
      throw new Error('The login response is missing a token or a recognised role.');
    }
    const {id, name, role, permissions} = result.user;
    this.session = {token: result.token, user: {id, name, email: result.user.email, role, permissions, portal}};
    try { sessionStorage.setItem(sessionKey, JSON.stringify(this.session)); }
    catch { /* The current page still works when storage is unavailable. */ }
  }

  private request<T>(method: string, path: string, body?: unknown) {
    return firstValueFrom(this.http.request<T>(method, '/api' + path, {
      body, headers: {Authorization: 'Bearer ' + this.session?.token}
    }));
  }

  myTasks() { return this.request<Task[]>('GET', '/tasks'); }
  allTasks() { return this.request<Task[]>('GET', '/admin/tasks'); }
  users() { return this.request<User[]>('GET', '/admin/users'); }
  saveTask(draft: Draft, id?: number) {
    return id === undefined ? this.request('POST', '/tasks', draft)
      : this.request('PUT', '/tasks/' + id, draft);
  }
  deleteTask(id: number) { return this.request('DELETE', '/tasks/' + id); }
  setTaskStatus(id: number, status: Task['status']) { return this.request('PATCH', '/tasks/' + id, {status}); }
  renameUser(id: number, name: string) { return this.request('PATCH', '/admin/users/' + id, {name}); }
  setPrivileges(id: number, role: User['role'], permissions: Permission[]) {
    return this.request('PATCH', '/admin/users/' + id, {role, permissions});
  }
  setUserActive(id: number, active: boolean) {
    return this.request('PATCH', '/admin/users/' + id, {is_active: active});
  }
}

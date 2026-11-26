import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { provideHttpClient, HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { Api, Draft, Task, User } from '../services/api';

function emptyTask(): Draft {
  return {title: '', description: '', priority: 'medium', due_date: null, status: 'pending'};
}

@Component({
  selector: 'app-root', standalone: true, imports: [FormsModule, DatePipe], templateUrl: './app.html'
})
class App {
  api = inject(Api);
  private readonly themeKey = 'taskfolio.theme';
  get darkMode() {
    const theme = document.documentElement.style.colorScheme;
    return theme ? theme === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  toggleTheme() {
    const theme = this.darkMode ? 'light' : 'dark';
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem(this.themeKey, theme); } catch { /* Storage may be disabled. */ }
  }
  private titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  register = false;
  showPassword = false;
  confirmation = '';
  editorOpen = false;
  renamingId?: number;
  displayName = '';
  deactivatingId?: number;
  email = ''; password = ''; name = '';
  busy = false; notice = ''; error = ''; loaded = false;
  tasksUnavailable = false; usersUnavailable = false;
  tasks: Task[] = []; users: User[] = [];
  filter = 'all'; query = '';
  ownerId: number | null = null;
  ownerLabels = new Map<number, string>();
  sort = 'default';
  draft = emptyTask(); editing?: number;
  get admin() { return this.api.session?.user.role === 'admin'; }
  get otherUsers() { return this.users.filter(user => user.id !== this.api.session?.user.id); }
  ngOnInit() {
    try {
      const theme = localStorage.getItem(this.themeKey);
      if (theme === 'dark' || theme === 'light') document.documentElement.style.colorScheme = theme;
    } catch { /* Use the system preference when storage is unavailable. */ }
    if (this.api.session) void this.reload();
  }
  get completed() { return this.tasks.filter(t => t.status === 'completed').length; }
  get visible() {
    const matches = this.tasks.filter(t => (this.filter === 'all' || t.status === this.filter)
      && (this.ownerId === null || t.user_id === this.ownerId)
      && t.title.toLowerCase().includes(this.query.trim().toLowerCase()));
    if (this.sort === 'due') {
      return matches.sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
    }
    if (this.sort === 'title') return matches.sort((a, b) => a.title.localeCompare(b.title));
    return matches;
  }
  async run(action: () => Promise<void>) {
    if (this.busy) return;
    this.busy = true; this.error = ''; this.notice = '';
    try { await action(); }
    catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 401 && this.api.session) this.logout();
      this.error = err instanceof HttpErrorResponse
        ? (err.error?.message || 'Request failed. Check your details and the API connection.')
        : err instanceof Error ? err.message : 'Request failed.';
    } finally { this.busy = false; }
  }
  async refresh() {
    this.loaded = false;
    this.tasksUnavailable = false;
    this.usersUnavailable = false;
    if (!this.admin) {
      this.tasks = await this.api.myTasks();
      this.loaded = true;
      return;
    }
    const [tasks, users] = await Promise.allSettled([this.api.allTasks(), this.api.users()]);
    for (const result of [tasks, users]) {
      if (result.status === 'rejected' && result.reason instanceof HttpErrorResponse && result.reason.status === 401) {
        throw result.reason;
      }
    }
    this.tasksUnavailable = tasks.status === 'rejected';
    this.usersUnavailable = users.status === 'rejected';
    this.tasks = tasks.status === 'fulfilled' ? tasks.value : [];
    this.setUsers(users.status === 'fulfilled' ? users.value : []);
    this.loaded = true;
  }
  private setUsers(users: User[]) {
    const nameCounts = new Map<string, number>();
    const nameKey = (u: User) => u.name.trim().toLowerCase();
    for (const user of users) {
      const key = nameKey(user);
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    this.ownerLabels = new Map(users.map(user => [
      user.id, nameCounts.get(nameKey(user)) === 1 ? user.name : user.name + ' (' + user.email + ')'
    ]));
    if (this.ownerId !== null && !this.ownerLabels.has(this.ownerId)) this.ownerId = null;
    this.users = users;
  }
  switchAuth(form: NgForm) {
    this.register = !this.register;
    this.showPassword = false;
    this.password = '';
    this.confirmation = '';
    this.error = '';
    this.notice = '';
    form.resetForm({name: this.name, email: this.email.trim(), password: '', confirmation: ''});
  }
  signIn(form: NgForm) {
    if (form.invalid || (this.register && (!this.name.trim() || this.password !== this.confirmation))) return;
    return this.run(async () => {
      if (this.register) {
        await this.api.register(this.name.trim(), this.email.trim(), this.password);
        this.switchAuth(form);
        this.notice = 'Account created. Sign in to open your dashboard.';
      } else {
        await this.api.login(this.email.trim(), this.password);
        this.showPassword = false;
        this.password = '';
        await this.refresh();
      }
      this.password = '';
    });
  }
  resetForm() { this.editing = undefined; this.draft = emptyTask(); this.editorOpen = false; }
  openEditor() {
    this.editorOpen = true;
    requestAnimationFrame(() => this.titleInput()?.nativeElement.focus());
  }
  dueLabel(t: Task) {
    if (!t.due_date || t.status === 'completed') return '';
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const days = (Date.parse(t.due_date.slice(0, 10) + 'T00:00:00Z') - today) / 86400000;
    if (days < 0) return Math.abs(days) + (days === -1 ? ' day overdue' : ' days overdue');
    if (days === 0) return 'Due today';
    return days === 1 ? 'Due tomorrow' : '';
  }
  edit(t: Task) {
    this.editing = t.id;
    this.draft = {title:t.title, description:t.description, priority:t.priority,
      due_date:t.due_date?.slice(0,10) || null, status:t.status};
    this.openEditor();
  }
  save() {
    return this.run(async () => {
      await this.api.saveTask({...this.draft, title:this.draft.title.trim(), due_date:this.draft.due_date || null}, this.editing);
      this.resetForm(); await this.refresh();
    });
  }
  toggle(t: Task) {
    return this.run(async () => {
      await this.api.setTaskStatus(t.id, t.status === 'pending' ? 'completed' : 'pending');
      if (this.editing === t.id) this.draft.status = t.status === 'pending' ? 'completed' : 'pending';
      await this.refresh();
    });
  }
  remove(t: Task) {
    if (confirm('Delete “' + t.title + '”?')) this.run(async () => {
      await this.api.deleteTask(t.id); if (this.editing === t.id) this.resetForm(); await this.refresh();
    });
  }
  rename(u: User) {
    const name = this.displayName.trim();
    if (!name || name.length > 100) return;
    return this.run(async () => {
      await this.api.renameUser(u.id, name);
      this.renamingId = undefined;
      await this.refresh();
    });
  }
  changeAccess(user: User) {
    if (user.id === this.api.session?.user.id || typeof user.is_active !== 'boolean') return;
    if (user.is_active && this.deactivatingId !== user.id) return;
    return this.run(async () => {
      await this.api.setUserActive(user.id, !user.is_active);
      this.deactivatingId = undefined;
      await this.refresh();
    });
  }
  reload() { return this.run(() => this.refresh()); }
  logout() {
    this.renamingId = undefined; this.deactivatingId = undefined; this.displayName = '';
    this.ownerLabels.clear(); this.ownerId = null;
    this.api.logout(); this.tasks = []; this.users = []; this.loaded = false;
    this.email = ''; this.password = ''; this.name = ''; this.query = ''; this.filter = 'all';
    this.sort = 'default'; this.notice = ''; this.error = ''; this.resetForm();
  }
}
bootstrapApplication(App, {providers:[provideHttpClient()]}).catch(console.error);

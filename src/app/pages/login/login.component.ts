import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { SessionService } from '../../core/session.service';
import { friendlyError } from '../../core/auth-errors';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './login.component.html'
})
export class LoginComponent {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  loginEmail = '';
  loginPassword = '';
  readonly loginError = signal('');
  readonly loggingIn = signal(false);

  async login(): Promise<void> {
    this.loginError.set('');
    this.loggingIn.set(true);
    try {
      await this.session.login(this.loginEmail, this.loginPassword);
      this.loginPassword = '';
      await this.router.navigateByUrl('/dashboard');
    } catch (e: any) {
      console.error('Login error:', e);
      this.loginError.set(friendlyError(e));
    } finally {
      this.loggingIn.set(false);
    }
  }
}

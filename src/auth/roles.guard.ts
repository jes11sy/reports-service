import { Injectable, CanActivate, ExecutionContext, SetMetadata, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export enum UserRole {
  MASTER = 'master',
  DIRECTOR = 'director',
  CALLCENTRE_ADMIN = 'admin',
  CALLCENTRE_OPERATOR = 'operator',
}

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);

@Injectable()
export class RolesGuard implements CanActivate {
  private readonly logger = new Logger(RolesGuard.name);

  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>('roles', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      this.logger.warn(`Unauthorized access attempt - No user in request`);
      throw new UnauthorizedException('User not authenticated');
    }

    const hasRole = requiredRoles.some((role) => user?.role === role);

    if (!hasRole) {
      this.logger.warn(
        `Unauthorized access attempt: User ${user.login} (role: ${user.role}) tried to access ${context.getClass().name}.${context.getHandler().name} - Required roles: ${requiredRoles.join(', ')}`
      );
    }

    return hasRole;
  }
}













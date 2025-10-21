import { Injectable, CanActivate, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export enum UserRole {
  MASTER = 'MASTER',
  DIRECTOR = 'DIRECTOR',
  CALLCENTRE_ADMIN = 'CALLCENTRE_ADMIN',
  CALLCENTRE_OPERATOR = 'CALLCENTRE_OPERATOR',
}

export const Roles = (...roles: UserRole[]) => SetMetadata('roles', roles);

@Injectable()
export class RolesGuard implements CanActivate {
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

    return requiredRoles.some((role) => user?.role === role);
  }
}


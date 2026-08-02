import { Body, Controller, Delete, Get, Param, Post, Req, UnauthorizedException } from '@nestjs/common';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { Public, Roles, JwtUser } from './auth.guards';

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsIn(['analyst', 'manager', 'super_admin'])
  role!: string;

  @IsOptional()
  @IsString()
  displayName?: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  async login(@Body() body: LoginDto) {
    const user = await this.authService.validateUser(body.email, body.password);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    return this.authService.login(user);
  }

  @Get('me')
  me(@Req() req: { user: JwtUser }) {
    return {
      id: req.user.sub,
      email: req.user.email,
      role: req.user.role,
      displayName: req.user.displayName,
    };
  }

  @Roles('super_admin')
  @Get('users')
  listUsers() {
    return this.authService.listUsers();
  }

  @Roles('super_admin')
  @Post('users')
  createUser(@Body() body: CreateUserDto) {
    return this.authService.createUser(body);
  }

  @Roles('super_admin')
  @Delete('users/:id')
  removeUser(@Param('id') id: string, @Req() req: { user: JwtUser }) {
    return this.authService.deleteUser(id, req.user.sub);
  }
}

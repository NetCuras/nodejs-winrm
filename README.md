# nodejs-winrm
nodejs-winrm is a NodeJS client to access WinRM (Windows Remote Management) SOAP web service. It allows to execute commands on target windows machines.
Please visit [Microsoft's WinRM site](http://msdn.microsoft.com/en-us/library/aa384426.aspx) for WINRM details.

## Supported NodeJS Versions

## Supported WinRM Versions

## Install

On the remote host, a PowerShell prompt, using the __Run as Administrator__ option and paste in the following lines:

```
winrm quickconfig
y
winrm set winrm/config/service/Auth '@{Basic="true"}'
winrm set winrm/config/service '@{AllowUnencrypted="true"}'
winrm set winrm/config/winrs '@{MaxMemoryPerShellMB="1024"}'
```
On the client side where NodeJS is installed

`npm install nodejs-winrm`

## Example
`winrm.shell('mkdir D:\\winrmtest001', '10.xxx.xxx.xxx', 5985, '/wsman', 'username', password);`

## Maintainers
* Shone Jacob (https://github.com/shoneslab)

## Credits
* https://github.com/jacobludriks/winrmjs
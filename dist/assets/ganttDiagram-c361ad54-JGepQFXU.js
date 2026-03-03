import{j as re,k as ae,R as ce,C as oe,m as De,n as Et,o as Ce,g as zt,d as Ee,s as pt,t as Se,a as Me,p as Ae,q as Zt,u as jt,v as Ut,x as Qt,y as Jt,z as Kt,A as $t,B as Ie,D as Le,E as Ye,F as Fe,G as We,H as Pe,I as ze,J as Oe}from"./index-5YXfi1iY.js";import{a8 as B,c as ot,s as Ve,g as Ne,n as Re,o as Be,b as qe,a as He,p as Ge,l as _t,h as Xe,i as Ze,u as je}from"./index-CGDVb0Ue.js";const Ue=Math.PI/180,Qe=180/Math.PI,Dt=18,le=.96422,ue=1,de=.82521,fe=4/29,lt=6/29,he=3*lt*lt,Je=lt*lt*lt;function me(t){if(t instanceof J)return new J(t.l,t.a,t.b,t.opacity);if(t instanceof tt)return ke(t);t instanceof ce||(t=De(t));var n=It(t.r),e=It(t.g),s=It(t.b),i=St((.2225045*n+.7168786*e+.0606169*s)/ue),h,d;return n===e&&e===s?h=d=i:(h=St((.4360747*n+.3850649*e+.1430804*s)/le),d=St((.0139322*n+.0971045*e+.7141733*s)/de)),new J(116*i-16,500*(h-i),200*(i-d),t.opacity)}function Ke(t,n,e,s){return arguments.length===1?me(t):new J(t,n,e,s??1)}function J(t,n,e,s){this.l=+t,this.a=+n,this.b=+e,this.opacity=+s}re(J,Ke,ae(oe,{brighter(t){return new J(this.l+Dt*(t??1),this.a,this.b,this.opacity)},darker(t){return new J(this.l-Dt*(t??1),this.a,this.b,this.opacity)},rgb(){var t=(this.l+16)/116,n=isNaN(this.a)?t:t+this.a/500,e=isNaN(this.b)?t:t-this.b/200;return n=le*Mt(n),t=ue*Mt(t),e=de*Mt(e),new ce(At(3.1338561*n-1.6168667*t-.4906146*e),At(-.9787684*n+1.9161415*t+.033454*e),At(.0719453*n-.2289914*t+1.4052427*e),this.opacity)}}));function St(t){return t>Je?Math.pow(t,1/3):t/he+fe}function Mt(t){return t>lt?t*t*t:he*(t-fe)}function At(t){return 255*(t<=.0031308?12.92*t:1.055*Math.pow(t,1/2.4)-.055)}function It(t){return(t/=255)<=.04045?t/12.92:Math.pow((t+.055)/1.055,2.4)}function $e(t){if(t instanceof tt)return new tt(t.h,t.c,t.l,t.opacity);if(t instanceof J||(t=me(t)),t.a===0&&t.b===0)return new tt(NaN,0<t.l&&t.l<100?0:NaN,t.l,t.opacity);var n=Math.atan2(t.b,t.a)*Qe;return new tt(n<0?n+360:n,Math.sqrt(t.a*t.a+t.b*t.b),t.l,t.opacity)}function Lt(t,n,e,s){return arguments.length===1?$e(t):new tt(t,n,e,s??1)}function tt(t,n,e,s){this.h=+t,this.c=+n,this.l=+e,this.opacity=+s}function ke(t){if(isNaN(t.h))return new J(t.l,0,0,t.opacity);var n=t.h*Ue;return new J(t.l,Math.cos(n)*t.c,Math.sin(n)*t.c,t.opacity)}re(tt,Lt,ae(oe,{brighter(t){return new tt(this.h,this.c,this.l+Dt*(t??1),this.opacity)},darker(t){return new tt(this.h,this.c,this.l-Dt*(t??1),this.opacity)},rgb(){return ke(this).rgb()}}));function tn(t){return function(n,e){var s=t((n=Lt(n)).h,(e=Lt(e)).h),i=Et(n.c,e.c),h=Et(n.l,e.l),d=Et(n.opacity,e.opacity);return function(v){return n.h=s(v),n.c=i(v),n.l=h(v),n.opacity=d(v),n+""}}}const en=tn(Ce);function nn(t,n){let e;if(n===void 0)for(const s of t)s!=null&&(e<s||e===void 0&&s>=s)&&(e=s);else{let s=-1;for(let i of t)(i=n(i,++s,t))!=null&&(e<i||e===void 0&&i>=i)&&(e=i)}return e}function sn(t,n){let e;if(n===void 0)for(const s of t)s!=null&&(e>s||e===void 0&&s>=s)&&(e=s);else{let s=-1;for(let i of t)(i=n(i,++s,t))!=null&&(e>i||e===void 0&&i>=i)&&(e=i)}return e}var bt={exports:{}},rn=bt.exports,te;function an(){return te||(te=1,function(t,n){(function(e,s){t.exports=s()})(rn,function(){var e="day";return function(s,i,h){var d=function(E){return E.add(4-E.isoWeekday(),e)},v=i.prototype;v.isoWeekYear=function(){return d(this).year()},v.isoWeek=function(E){if(!this.$utils().u(E))return this.add(7*(E-this.isoWeek()),e);var p,S,P,z,N=d(this),C=(p=this.isoWeekYear(),S=this.$u,P=(S?h.utc:h)().year(p).startOf("year"),z=4-P.isoWeekday(),P.isoWeekday()>4&&(z+=7),P.add(z,e));return N.diff(C,"week")+1},v.isoWeekday=function(E){return this.$utils().u(E)?this.day()||7:this.day(this.day()%7?E:E-7)};var F=v.startOf;v.startOf=function(E,p){var S=this.$utils(),P=!!S.u(p)||p;return S.p(E)==="isoweek"?P?this.date(this.date()-(this.isoWeekday()-1)).startOf("day"):this.date(this.date()-1-(this.isoWeekday()-1)+7).endOf("day"):F.bind(this)(E,p)}}})}(bt)),bt.exports}var cn=an();const on=zt(cn);var vt={exports:{}},ln=vt.exports,ee;function un(){return ee||(ee=1,function(t,n){(function(e,s){t.exports=s()})(ln,function(){var e={LTS:"h:mm:ss A",LT:"h:mm A",L:"MM/DD/YYYY",LL:"MMMM D, YYYY",LLL:"MMMM D, YYYY h:mm A",LLLL:"dddd, MMMM D, YYYY h:mm A"},s=/(\[[^[]*\])|([-_:/.,()\s]+)|(A|a|Q|YYYY|YY?|ww?|MM?M?M?|Do|DD?|hh?|HH?|mm?|ss?|S{1,3}|z|ZZ?)/g,i=/\d/,h=/\d\d/,d=/\d\d?/,v=/\d*[^-_:/,()\s\d]+/,F={},E=function(b){return(b=+b)+(b>68?1900:2e3)},p=function(b){return function(D){this[b]=+D}},S=[/[+-]\d\d:?(\d\d)?|Z/,function(b){(this.zone||(this.zone={})).offset=function(D){if(!D||D==="Z")return 0;var I=D.match(/([+-]|\d\d)/g),Y=60*I[1]+(+I[2]||0);return Y===0?0:I[0]==="+"?-Y:Y}(b)}],P=function(b){var D=F[b];return D&&(D.indexOf?D:D.s.concat(D.f))},z=function(b,D){var I,Y=F.meridiem;if(Y){for(var q=1;q<=24;q+=1)if(b.indexOf(Y(q,0,D))>-1){I=q>12;break}}else I=b===(D?"pm":"PM");return I},N={A:[v,function(b){this.afternoon=z(b,!1)}],a:[v,function(b){this.afternoon=z(b,!0)}],Q:[i,function(b){this.month=3*(b-1)+1}],S:[i,function(b){this.milliseconds=100*+b}],SS:[h,function(b){this.milliseconds=10*+b}],SSS:[/\d{3}/,function(b){this.milliseconds=+b}],s:[d,p("seconds")],ss:[d,p("seconds")],m:[d,p("minutes")],mm:[d,p("minutes")],H:[d,p("hours")],h:[d,p("hours")],HH:[d,p("hours")],hh:[d,p("hours")],D:[d,p("day")],DD:[h,p("day")],Do:[v,function(b){var D=F.ordinal,I=b.match(/\d+/);if(this.day=I[0],D)for(var Y=1;Y<=31;Y+=1)D(Y).replace(/\[|\]/g,"")===b&&(this.day=Y)}],w:[d,p("week")],ww:[h,p("week")],M:[d,p("month")],MM:[h,p("month")],MMM:[v,function(b){var D=P("months"),I=(P("monthsShort")||D.map(function(Y){return Y.slice(0,3)})).indexOf(b)+1;if(I<1)throw new Error;this.month=I%12||I}],MMMM:[v,function(b){var D=P("months").indexOf(b)+1;if(D<1)throw new Error;this.month=D%12||D}],Y:[/[+-]?\d+/,p("year")],YY:[h,function(b){this.year=E(b)}],YYYY:[/\d{4}/,p("year")],Z:S,ZZ:S};function C(b){var D,I;D=b,I=F&&F.formats;for(var Y=(b=D.replace(/(\[[^\]]+])|(LTS?|l{1,4}|L{1,4})/g,function(x,g,a){var u=a&&a.toUpperCase();return g||I[a]||e[a]||I[u].replace(/(\[[^\]]+])|(MMMM|MM|DD|dddd)/g,function(f,c,y){return c||y.slice(1)})})).match(s),q=Y.length,H=0;H<q;H+=1){var U=Y[H],X=N[U],k=X&&X[0],T=X&&X[1];Y[H]=T?{regex:k,parser:T}:U.replace(/^\[|\]$/g,"")}return function(x){for(var g={},a=0,u=0;a<q;a+=1){var f=Y[a];if(typeof f=="string")u+=f.length;else{var c=f.regex,y=f.parser,r=x.slice(u),W=c.exec(r)[0];y.call(g,W),x=x.replace(W,"")}}return function(l){var o=l.afternoon;if(o!==void 0){var m=l.hours;o?m<12&&(l.hours+=12):m===12&&(l.hours=0),delete l.afternoon}}(g),g}}return function(b,D,I){I.p.customParseFormat=!0,b&&b.parseTwoDigitYear&&(E=b.parseTwoDigitYear);var Y=D.prototype,q=Y.parse;Y.parse=function(H){var U=H.date,X=H.utc,k=H.args;this.$u=X;var T=k[1];if(typeof T=="string"){var x=k[2]===!0,g=k[3]===!0,a=x||g,u=k[2];g&&(u=k[2]),F=this.$locale(),!x&&u&&(F=I.Ls[u]),this.$d=function(r,W,l,o){try{if(["x","X"].indexOf(W)>-1)return new Date((W==="X"?1e3:1)*r);var m=C(W)(r),L=m.year,w=m.month,M=m.day,_=m.hours,A=m.minutes,it=m.seconds,rt=m.milliseconds,kt=m.zone,yt=m.week,V=new Date,Z=M||(L||w?1:V.getDate()),R=L||V.getFullYear(),et=0;L&&!w||(et=w>0?w-1:V.getMonth());var j,nt=_||0,G=A||0,ct=it||0,st=rt||0;return kt?new Date(Date.UTC(R,et,Z,nt,G,ct,st+60*kt.offset*1e3)):l?new Date(Date.UTC(R,et,Z,nt,G,ct,st)):(j=new Date(R,et,Z,nt,G,ct,st),yt&&(j=o(j).week(yt).toDate()),j)}catch{return new Date("")}}(U,T,X,I),this.init(),u&&u!==!0&&(this.$L=this.locale(u).$L),a&&U!=this.format(T)&&(this.$d=new Date("")),F={}}else if(T instanceof Array)for(var f=T.length,c=1;c<=f;c+=1){k[1]=T[c-1];var y=I.apply(this,k);if(y.isValid()){this.$d=y.$d,this.$L=y.$L,this.init();break}c===f&&(this.$d=new Date(""))}else q.call(this,H)}}})}(vt)),vt.exports}var dn=un();const fn=zt(dn);var xt={exports:{}},hn=xt.exports,ne;function mn(){return ne||(ne=1,function(t,n){(function(e,s){t.exports=s()})(hn,function(){return function(e,s){var i=s.prototype,h=i.format;i.format=function(d){var v=this,F=this.$locale();if(!this.isValid())return h.bind(this)(d);var E=this.$utils(),p=(d||"YYYY-MM-DDTHH:mm:ssZ").replace(/\[([^\]]+)]|Q|wo|ww|w|WW|W|zzz|z|gggg|GGGG|Do|X|x|k{1,2}|S/g,function(S){switch(S){case"Q":return Math.ceil((v.$M+1)/3);case"Do":return F.ordinal(v.$D);case"gggg":return v.weekYear();case"GGGG":return v.isoWeekYear();case"wo":return F.ordinal(v.week(),"W");case"w":case"ww":return E.s(v.week(),S==="w"?1:2,"0");case"W":case"WW":return E.s(v.isoWeek(),S==="W"?1:2,"0");case"k":case"kk":return E.s(String(v.$H===0?24:v.$H),S==="k"?1:2,"0");case"X":return Math.floor(v.$d.getTime()/1e3);case"x":return v.$d.getTime();case"z":return"["+v.offsetName()+"]";case"zzz":return"["+v.offsetName("long")+"]";default:return S}});return h.bind(this)(p)}}})}(xt)),xt.exports}var kn=mn();const yn=zt(kn);var Yt=function(){var t=function(g,a,u,f){for(u=u||{},f=g.length;f--;u[g[f]]=a);return u},n=[6,8,10,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,30,32,33,35,37],e=[1,25],s=[1,26],i=[1,27],h=[1,28],d=[1,29],v=[1,30],F=[1,31],E=[1,9],p=[1,10],S=[1,11],P=[1,12],z=[1,13],N=[1,14],C=[1,15],b=[1,16],D=[1,18],I=[1,19],Y=[1,20],q=[1,21],H=[1,22],U=[1,24],X=[1,32],k={trace:function(){},yy:{},symbols_:{error:2,start:3,gantt:4,document:5,EOF:6,line:7,SPACE:8,statement:9,NL:10,weekday:11,weekday_monday:12,weekday_tuesday:13,weekday_wednesday:14,weekday_thursday:15,weekday_friday:16,weekday_saturday:17,weekday_sunday:18,dateFormat:19,inclusiveEndDates:20,topAxis:21,axisFormat:22,tickInterval:23,excludes:24,includes:25,todayMarker:26,title:27,acc_title:28,acc_title_value:29,acc_descr:30,acc_descr_value:31,acc_descr_multiline_value:32,section:33,clickStatement:34,taskTxt:35,taskData:36,click:37,callbackname:38,callbackargs:39,href:40,clickStatementDebug:41,$accept:0,$end:1},terminals_:{2:"error",4:"gantt",6:"EOF",8:"SPACE",10:"NL",12:"weekday_monday",13:"weekday_tuesday",14:"weekday_wednesday",15:"weekday_thursday",16:"weekday_friday",17:"weekday_saturday",18:"weekday_sunday",19:"dateFormat",20:"inclusiveEndDates",21:"topAxis",22:"axisFormat",23:"tickInterval",24:"excludes",25:"includes",26:"todayMarker",27:"title",28:"acc_title",29:"acc_title_value",30:"acc_descr",31:"acc_descr_value",32:"acc_descr_multiline_value",33:"section",35:"taskTxt",36:"taskData",37:"click",38:"callbackname",39:"callbackargs",40:"href"},productions_:[0,[3,3],[5,0],[5,2],[7,2],[7,1],[7,1],[7,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[11,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,1],[9,2],[9,2],[9,1],[9,1],[9,1],[9,2],[34,2],[34,3],[34,3],[34,4],[34,3],[34,4],[34,2],[41,2],[41,3],[41,3],[41,4],[41,3],[41,4],[41,2]],performAction:function(a,u,f,c,y,r,W){var l=r.length-1;switch(y){case 1:return r[l-1];case 2:this.$=[];break;case 3:r[l-1].push(r[l]),this.$=r[l-1];break;case 4:case 5:this.$=r[l];break;case 6:case 7:this.$=[];break;case 8:c.setWeekday("monday");break;case 9:c.setWeekday("tuesday");break;case 10:c.setWeekday("wednesday");break;case 11:c.setWeekday("thursday");break;case 12:c.setWeekday("friday");break;case 13:c.setWeekday("saturday");break;case 14:c.setWeekday("sunday");break;case 15:c.setDateFormat(r[l].substr(11)),this.$=r[l].substr(11);break;case 16:c.enableInclusiveEndDates(),this.$=r[l].substr(18);break;case 17:c.TopAxis(),this.$=r[l].substr(8);break;case 18:c.setAxisFormat(r[l].substr(11)),this.$=r[l].substr(11);break;case 19:c.setTickInterval(r[l].substr(13)),this.$=r[l].substr(13);break;case 20:c.setExcludes(r[l].substr(9)),this.$=r[l].substr(9);break;case 21:c.setIncludes(r[l].substr(9)),this.$=r[l].substr(9);break;case 22:c.setTodayMarker(r[l].substr(12)),this.$=r[l].substr(12);break;case 24:c.setDiagramTitle(r[l].substr(6)),this.$=r[l].substr(6);break;case 25:this.$=r[l].trim(),c.setAccTitle(this.$);break;case 26:case 27:this.$=r[l].trim(),c.setAccDescription(this.$);break;case 28:c.addSection(r[l].substr(8)),this.$=r[l].substr(8);break;case 30:c.addTask(r[l-1],r[l]),this.$="task";break;case 31:this.$=r[l-1],c.setClickEvent(r[l-1],r[l],null);break;case 32:this.$=r[l-2],c.setClickEvent(r[l-2],r[l-1],r[l]);break;case 33:this.$=r[l-2],c.setClickEvent(r[l-2],r[l-1],null),c.setLink(r[l-2],r[l]);break;case 34:this.$=r[l-3],c.setClickEvent(r[l-3],r[l-2],r[l-1]),c.setLink(r[l-3],r[l]);break;case 35:this.$=r[l-2],c.setClickEvent(r[l-2],r[l],null),c.setLink(r[l-2],r[l-1]);break;case 36:this.$=r[l-3],c.setClickEvent(r[l-3],r[l-1],r[l]),c.setLink(r[l-3],r[l-2]);break;case 37:this.$=r[l-1],c.setLink(r[l-1],r[l]);break;case 38:case 44:this.$=r[l-1]+" "+r[l];break;case 39:case 40:case 42:this.$=r[l-2]+" "+r[l-1]+" "+r[l];break;case 41:case 43:this.$=r[l-3]+" "+r[l-2]+" "+r[l-1]+" "+r[l];break}},table:[{3:1,4:[1,2]},{1:[3]},t(n,[2,2],{5:3}),{6:[1,4],7:5,8:[1,6],9:7,10:[1,8],11:17,12:e,13:s,14:i,15:h,16:d,17:v,18:F,19:E,20:p,21:S,22:P,23:z,24:N,25:C,26:b,27:D,28:I,30:Y,32:q,33:H,34:23,35:U,37:X},t(n,[2,7],{1:[2,1]}),t(n,[2,3]),{9:33,11:17,12:e,13:s,14:i,15:h,16:d,17:v,18:F,19:E,20:p,21:S,22:P,23:z,24:N,25:C,26:b,27:D,28:I,30:Y,32:q,33:H,34:23,35:U,37:X},t(n,[2,5]),t(n,[2,6]),t(n,[2,15]),t(n,[2,16]),t(n,[2,17]),t(n,[2,18]),t(n,[2,19]),t(n,[2,20]),t(n,[2,21]),t(n,[2,22]),t(n,[2,23]),t(n,[2,24]),{29:[1,34]},{31:[1,35]},t(n,[2,27]),t(n,[2,28]),t(n,[2,29]),{36:[1,36]},t(n,[2,8]),t(n,[2,9]),t(n,[2,10]),t(n,[2,11]),t(n,[2,12]),t(n,[2,13]),t(n,[2,14]),{38:[1,37],40:[1,38]},t(n,[2,4]),t(n,[2,25]),t(n,[2,26]),t(n,[2,30]),t(n,[2,31],{39:[1,39],40:[1,40]}),t(n,[2,37],{38:[1,41]}),t(n,[2,32],{40:[1,42]}),t(n,[2,33]),t(n,[2,35],{39:[1,43]}),t(n,[2,34]),t(n,[2,36])],defaultActions:{},parseError:function(a,u){if(u.recoverable)this.trace(a);else{var f=new Error(a);throw f.hash=u,f}},parse:function(a){var u=this,f=[0],c=[],y=[null],r=[],W=this.table,l="",o=0,m=0,L=2,w=1,M=r.slice.call(arguments,1),_=Object.create(this.lexer),A={yy:{}};for(var it in this.yy)Object.prototype.hasOwnProperty.call(this.yy,it)&&(A.yy[it]=this.yy[it]);_.setInput(a,A.yy),A.yy.lexer=_,A.yy.parser=this,typeof _.yylloc>"u"&&(_.yylloc={});var rt=_.yylloc;r.push(rt);var kt=_.options&&_.options.ranges;typeof A.yy.parseError=="function"?this.parseError=A.yy.parseError:this.parseError=Object.getPrototypeOf(this).parseError;function yt(){var K;return K=c.pop()||_.lex()||w,typeof K!="number"&&(K instanceof Array&&(c=K,K=c.pop()),K=u.symbols_[K]||K),K}for(var V,Z,R,et,j={},nt,G,ct,st;;){if(Z=f[f.length-1],this.defaultActions[Z]?R=this.defaultActions[Z]:((V===null||typeof V>"u")&&(V=yt()),R=W[Z]&&W[Z][V]),typeof R>"u"||!R.length||!R[0]){var gt="";st=[];for(nt in W[Z])this.terminals_[nt]&&nt>L&&st.push("'"+this.terminals_[nt]+"'");_.showPosition?gt="Parse error on line "+(o+1)+`:
`+_.showPosition()+`
Expecting `+st.join(", ")+", got '"+(this.terminals_[V]||V)+"'":gt="Parse error on line "+(o+1)+": Unexpected "+(V==w?"end of input":"'"+(this.terminals_[V]||V)+"'"),this.parseError(gt,{text:_.match,token:this.terminals_[V]||V,line:_.yylineno,loc:rt,expected:st})}if(R[0]instanceof Array&&R.length>1)throw new Error("Parse Error: multiple actions possible at state: "+Z+", token: "+V);switch(R[0]){case 1:f.push(V),y.push(_.yytext),r.push(_.yylloc),f.push(R[1]),V=null,m=_.yyleng,l=_.yytext,o=_.yylineno,rt=_.yylloc;break;case 2:if(G=this.productions_[R[1]][1],j.$=y[y.length-G],j._$={first_line:r[r.length-(G||1)].first_line,last_line:r[r.length-1].last_line,first_column:r[r.length-(G||1)].first_column,last_column:r[r.length-1].last_column},kt&&(j._$.range=[r[r.length-(G||1)].range[0],r[r.length-1].range[1]]),et=this.performAction.apply(j,[l,m,o,A.yy,R[1],y,r].concat(M)),typeof et<"u")return et;G&&(f=f.slice(0,-1*G*2),y=y.slice(0,-1*G),r=r.slice(0,-1*G)),f.push(this.productions_[R[1]][0]),y.push(j.$),r.push(j._$),ct=W[f[f.length-2]][f[f.length-1]],f.push(ct);break;case 3:return!0}}return!0}},T=function(){var g={EOF:1,parseError:function(u,f){if(this.yy.parser)this.yy.parser.parseError(u,f);else throw new Error(u)},setInput:function(a,u){return this.yy=u||this.yy||{},this._input=a,this._more=this._backtrack=this.done=!1,this.yylineno=this.yyleng=0,this.yytext=this.matched=this.match="",this.conditionStack=["INITIAL"],this.yylloc={first_line:1,first_column:0,last_line:1,last_column:0},this.options.ranges&&(this.yylloc.range=[0,0]),this.offset=0,this},input:function(){var a=this._input[0];this.yytext+=a,this.yyleng++,this.offset++,this.match+=a,this.matched+=a;var u=a.match(/(?:\r\n?|\n).*/g);return u?(this.yylineno++,this.yylloc.last_line++):this.yylloc.last_column++,this.options.ranges&&this.yylloc.range[1]++,this._input=this._input.slice(1),a},unput:function(a){var u=a.length,f=a.split(/(?:\r\n?|\n)/g);this._input=a+this._input,this.yytext=this.yytext.substr(0,this.yytext.length-u),this.offset-=u;var c=this.match.split(/(?:\r\n?|\n)/g);this.match=this.match.substr(0,this.match.length-1),this.matched=this.matched.substr(0,this.matched.length-1),f.length-1&&(this.yylineno-=f.length-1);var y=this.yylloc.range;return this.yylloc={first_line:this.yylloc.first_line,last_line:this.yylineno+1,first_column:this.yylloc.first_column,last_column:f?(f.length===c.length?this.yylloc.first_column:0)+c[c.length-f.length].length-f[0].length:this.yylloc.first_column-u},this.options.ranges&&(this.yylloc.range=[y[0],y[0]+this.yyleng-u]),this.yyleng=this.yytext.length,this},more:function(){return this._more=!0,this},reject:function(){if(this.options.backtrack_lexer)this._backtrack=!0;else return this.parseError("Lexical error on line "+(this.yylineno+1)+`. You can only invoke reject() in the lexer when the lexer is of the backtracking persuasion (options.backtrack_lexer = true).
`+this.showPosition(),{text:"",token:null,line:this.yylineno});return this},less:function(a){this.unput(this.match.slice(a))},pastInput:function(){var a=this.matched.substr(0,this.matched.length-this.match.length);return(a.length>20?"...":"")+a.substr(-20).replace(/\n/g,"")},upcomingInput:function(){var a=this.match;return a.length<20&&(a+=this._input.substr(0,20-a.length)),(a.substr(0,20)+(a.length>20?"...":"")).replace(/\n/g,"")},showPosition:function(){var a=this.pastInput(),u=new Array(a.length+1).join("-");return a+this.upcomingInput()+`
`+u+"^"},test_match:function(a,u){var f,c,y;if(this.options.backtrack_lexer&&(y={yylineno:this.yylineno,yylloc:{first_line:this.yylloc.first_line,last_line:this.last_line,first_column:this.yylloc.first_column,last_column:this.yylloc.last_column},yytext:this.yytext,match:this.match,matches:this.matches,matched:this.matched,yyleng:this.yyleng,offset:this.offset,_more:this._more,_input:this._input,yy:this.yy,conditionStack:this.conditionStack.slice(0),done:this.done},this.options.ranges&&(y.yylloc.range=this.yylloc.range.slice(0))),c=a[0].match(/(?:\r\n?|\n).*/g),c&&(this.yylineno+=c.length),this.yylloc={first_line:this.yylloc.last_line,last_line:this.yylineno+1,first_column:this.yylloc.last_column,last_column:c?c[c.length-1].length-c[c.length-1].match(/\r?\n?/)[0].length:this.yylloc.last_column+a[0].length},this.yytext+=a[0],this.match+=a[0],this.matches=a,this.yyleng=this.yytext.length,this.options.ranges&&(this.yylloc.range=[this.offset,this.offset+=this.yyleng]),this._more=!1,this._backtrack=!1,this._input=this._input.slice(a[0].length),this.matched+=a[0],f=this.performAction.call(this,this.yy,this,u,this.conditionStack[this.conditionStack.length-1]),this.done&&this._input&&(this.done=!1),f)return f;if(this._backtrack){for(var r in y)this[r]=y[r];return!1}return!1},next:function(){if(this.done)return this.EOF;this._input||(this.done=!0);var a,u,f,c;this._more||(this.yytext="",this.match="");for(var y=this._currentRules(),r=0;r<y.length;r++)if(f=this._input.match(this.rules[y[r]]),f&&(!u||f[0].length>u[0].length)){if(u=f,c=r,this.options.backtrack_lexer){if(a=this.test_match(f,y[r]),a!==!1)return a;if(this._backtrack){u=!1;continue}else return!1}else if(!this.options.flex)break}return u?(a=this.test_match(u,y[c]),a!==!1?a:!1):this._input===""?this.EOF:this.parseError("Lexical error on line "+(this.yylineno+1)+`. Unrecognized text.
`+this.showPosition(),{text:"",token:null,line:this.yylineno})},lex:function(){var u=this.next();return u||this.lex()},begin:function(u){this.conditionStack.push(u)},popState:function(){var u=this.conditionStack.length-1;return u>0?this.conditionStack.pop():this.conditionStack[0]},_currentRules:function(){return this.conditionStack.length&&this.conditionStack[this.conditionStack.length-1]?this.conditions[this.conditionStack[this.conditionStack.length-1]].rules:this.conditions.INITIAL.rules},topState:function(u){return u=this.conditionStack.length-1-Math.abs(u||0),u>=0?this.conditionStack[u]:"INITIAL"},pushState:function(u){this.begin(u)},stateStackSize:function(){return this.conditionStack.length},options:{"case-insensitive":!0},performAction:function(u,f,c,y){switch(c){case 0:return this.begin("open_directive"),"open_directive";case 1:return this.begin("acc_title"),28;case 2:return this.popState(),"acc_title_value";case 3:return this.begin("acc_descr"),30;case 4:return this.popState(),"acc_descr_value";case 5:this.begin("acc_descr_multiline");break;case 6:this.popState();break;case 7:return"acc_descr_multiline_value";case 8:break;case 9:break;case 10:break;case 11:return 10;case 12:break;case 13:break;case 14:this.begin("href");break;case 15:this.popState();break;case 16:return 40;case 17:this.begin("callbackname");break;case 18:this.popState();break;case 19:this.popState(),this.begin("callbackargs");break;case 20:return 38;case 21:this.popState();break;case 22:return 39;case 23:this.begin("click");break;case 24:this.popState();break;case 25:return 37;case 26:return 4;case 27:return 19;case 28:return 20;case 29:return 21;case 30:return 22;case 31:return 23;case 32:return 25;case 33:return 24;case 34:return 26;case 35:return 12;case 36:return 13;case 37:return 14;case 38:return 15;case 39:return 16;case 40:return 17;case 41:return 18;case 42:return"date";case 43:return 27;case 44:return"accDescription";case 45:return 33;case 46:return 35;case 47:return 36;case 48:return":";case 49:return 6;case 50:return"INVALID"}},rules:[/^(?:%%\{)/i,/^(?:accTitle\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*:\s*)/i,/^(?:(?!\n||)*[^\n]*)/i,/^(?:accDescr\s*\{\s*)/i,/^(?:[\}])/i,/^(?:[^\}]*)/i,/^(?:%%(?!\{)*[^\n]*)/i,/^(?:[^\}]%%*[^\n]*)/i,/^(?:%%*[^\n]*[\n]*)/i,/^(?:[\n]+)/i,/^(?:\s+)/i,/^(?:%[^\n]*)/i,/^(?:href[\s]+["])/i,/^(?:["])/i,/^(?:[^"]*)/i,/^(?:call[\s]+)/i,/^(?:\([\s]*\))/i,/^(?:\()/i,/^(?:[^(]*)/i,/^(?:\))/i,/^(?:[^)]*)/i,/^(?:click[\s]+)/i,/^(?:[\s\n])/i,/^(?:[^\s\n]*)/i,/^(?:gantt\b)/i,/^(?:dateFormat\s[^#\n;]+)/i,/^(?:inclusiveEndDates\b)/i,/^(?:topAxis\b)/i,/^(?:axisFormat\s[^#\n;]+)/i,/^(?:tickInterval\s[^#\n;]+)/i,/^(?:includes\s[^#\n;]+)/i,/^(?:excludes\s[^#\n;]+)/i,/^(?:todayMarker\s[^\n;]+)/i,/^(?:weekday\s+monday\b)/i,/^(?:weekday\s+tuesday\b)/i,/^(?:weekday\s+wednesday\b)/i,/^(?:weekday\s+thursday\b)/i,/^(?:weekday\s+friday\b)/i,/^(?:weekday\s+saturday\b)/i,/^(?:weekday\s+sunday\b)/i,/^(?:\d\d\d\d-\d\d-\d\d\b)/i,/^(?:title\s[^\n]+)/i,/^(?:accDescription\s[^#\n;]+)/i,/^(?:section\s[^\n]+)/i,/^(?:[^:\n]+)/i,/^(?::[^#\n;]+)/i,/^(?::)/i,/^(?:$)/i,/^(?:.)/i],conditions:{acc_descr_multiline:{rules:[6,7],inclusive:!1},acc_descr:{rules:[4],inclusive:!1},acc_title:{rules:[2],inclusive:!1},callbackargs:{rules:[21,22],inclusive:!1},callbackname:{rules:[18,19,20],inclusive:!1},href:{rules:[15,16],inclusive:!1},click:{rules:[24,25],inclusive:!1},INITIAL:{rules:[0,1,3,5,8,9,10,11,12,13,14,17,23,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50],inclusive:!0}}};return g}();k.lexer=T;function x(){this.yy={}}return x.prototype=k,k.Parser=x,new x}();Yt.parser=Yt;const gn=Yt;B.extend(on);B.extend(fn);B.extend(yn);let Q="",Ot="",Vt,Nt="",ft=[],ht=[],Rt={},Bt=[],Ct=[],dt="",qt="";const ye=["active","done","crit","milestone"];let Ht=[],mt=!1,Gt=!1,Xt="sunday",Ft=0;const pn=function(){Bt=[],Ct=[],dt="",Ht=[],Tt=0,Pt=void 0,wt=void 0,O=[],Q="",Ot="",qt="",Vt=void 0,Nt="",ft=[],ht=[],mt=!1,Gt=!1,Ft=0,Rt={},Ge(),Xt="sunday"},bn=function(t){Ot=t},vn=function(){return Ot},xn=function(t){Vt=t},Tn=function(){return Vt},wn=function(t){Nt=t},_n=function(){return Nt},Dn=function(t){Q=t},Cn=function(){mt=!0},En=function(){return mt},Sn=function(){Gt=!0},Mn=function(){return Gt},An=function(t){qt=t},In=function(){return qt},Ln=function(){return Q},Yn=function(t){ft=t.toLowerCase().split(/[\s,]+/)},Fn=function(){return ft},Wn=function(t){ht=t.toLowerCase().split(/[\s,]+/)},Pn=function(){return ht},zn=function(){return Rt},On=function(t){dt=t,Bt.push(t)},Vn=function(){return Bt},Nn=function(){let t=se();const n=10;let e=0;for(;!t&&e<n;)t=se(),e++;return Ct=O,Ct},ge=function(t,n,e,s){return s.includes(t.format(n.trim()))?!1:t.isoWeekday()>=6&&e.includes("weekends")||e.includes(t.format("dddd").toLowerCase())?!0:e.includes(t.format(n.trim()))},Rn=function(t){Xt=t},Bn=function(){return Xt},pe=function(t,n,e,s){if(!e.length||t.manualEndTime)return;let i;t.startTime instanceof Date?i=B(t.startTime):i=B(t.startTime,n,!0),i=i.add(1,"d");let h;t.endTime instanceof Date?h=B(t.endTime):h=B(t.endTime,n,!0);const[d,v]=qn(i,h,n,e,s);t.endTime=d.toDate(),t.renderEndTime=v},qn=function(t,n,e,s,i){let h=!1,d=null;for(;t<=n;)h||(d=n.toDate()),h=ge(t,e,s,i),h&&(n=n.add(1,"d")),t=t.add(1,"d");return[n,d]},Wt=function(t,n,e){e=e.trim();const i=/^after\s+(?<ids>[\d\w- ]+)/.exec(e);if(i!==null){let d=null;for(const F of i.groups.ids.split(" ")){let E=at(F);E!==void 0&&(!d||E.endTime>d.endTime)&&(d=E)}if(d)return d.endTime;const v=new Date;return v.setHours(0,0,0,0),v}let h=B(e,n.trim(),!0);if(h.isValid())return h.toDate();{_t.debug("Invalid date:"+e),_t.debug("With date format:"+n.trim());const d=new Date(e);if(d===void 0||isNaN(d.getTime())||d.getFullYear()<-1e4||d.getFullYear()>1e4)throw new Error("Invalid date:"+e);return d}},be=function(t){const n=/^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/.exec(t.trim());return n!==null?[Number.parseFloat(n[1]),n[2]]:[NaN,"ms"]},ve=function(t,n,e,s=!1){e=e.trim();const h=/^until\s+(?<ids>[\d\w- ]+)/.exec(e);if(h!==null){let p=null;for(const P of h.groups.ids.split(" ")){let z=at(P);z!==void 0&&(!p||z.startTime<p.startTime)&&(p=z)}if(p)return p.startTime;const S=new Date;return S.setHours(0,0,0,0),S}let d=B(e,n.trim(),!0);if(d.isValid())return s&&(d=d.add(1,"d")),d.toDate();let v=B(t);const[F,E]=be(e);if(!Number.isNaN(F)){const p=v.add(F,E);p.isValid()&&(v=p)}return v.toDate()};let Tt=0;const ut=function(t){return t===void 0?(Tt=Tt+1,"task"+Tt):t},Hn=function(t,n){let e;n.substr(0,1)===":"?e=n.substr(1,n.length):e=n;const s=e.split(","),i={};_e(s,i,ye);for(let d=0;d<s.length;d++)s[d]=s[d].trim();let h="";switch(s.length){case 1:i.id=ut(),i.startTime=t.endTime,h=s[0];break;case 2:i.id=ut(),i.startTime=Wt(void 0,Q,s[0]),h=s[1];break;case 3:i.id=ut(s[0]),i.startTime=Wt(void 0,Q,s[1]),h=s[2];break}return h&&(i.endTime=ve(i.startTime,Q,h,mt),i.manualEndTime=B(h,"YYYY-MM-DD",!0).isValid(),pe(i,Q,ht,ft)),i},Gn=function(t,n){let e;n.substr(0,1)===":"?e=n.substr(1,n.length):e=n;const s=e.split(","),i={};_e(s,i,ye);for(let h=0;h<s.length;h++)s[h]=s[h].trim();switch(s.length){case 1:i.id=ut(),i.startTime={type:"prevTaskEnd",id:t},i.endTime={data:s[0]};break;case 2:i.id=ut(),i.startTime={type:"getStartDate",startData:s[0]},i.endTime={data:s[1]};break;case 3:i.id=ut(s[0]),i.startTime={type:"getStartDate",startData:s[1]},i.endTime={data:s[2]};break}return i};let Pt,wt,O=[];const xe={},Xn=function(t,n){const e={section:dt,type:dt,processed:!1,manualEndTime:!1,renderEndTime:null,raw:{data:n},task:t,classes:[]},s=Gn(wt,n);e.raw.startTime=s.startTime,e.raw.endTime=s.endTime,e.id=s.id,e.prevTaskId=wt,e.active=s.active,e.done=s.done,e.crit=s.crit,e.milestone=s.milestone,e.order=Ft,Ft++;const i=O.push(e);wt=e.id,xe[e.id]=i-1},at=function(t){const n=xe[t];return O[n]},Zn=function(t,n){const e={section:dt,type:dt,description:t,task:t,classes:[]},s=Hn(Pt,n);e.startTime=s.startTime,e.endTime=s.endTime,e.id=s.id,e.active=s.active,e.done=s.done,e.crit=s.crit,e.milestone=s.milestone,Pt=e,Ct.push(e)},se=function(){const t=function(e){const s=O[e];let i="";switch(O[e].raw.startTime.type){case"prevTaskEnd":{const h=at(s.prevTaskId);s.startTime=h.endTime;break}case"getStartDate":i=Wt(void 0,Q,O[e].raw.startTime.startData),i&&(O[e].startTime=i);break}return O[e].startTime&&(O[e].endTime=ve(O[e].startTime,Q,O[e].raw.endTime.data,mt),O[e].endTime&&(O[e].processed=!0,O[e].manualEndTime=B(O[e].raw.endTime.data,"YYYY-MM-DD",!0).isValid(),pe(O[e],Q,ht,ft))),O[e].processed};let n=!0;for(const[e,s]of O.entries())t(e),n=n&&s.processed;return n},jn=function(t,n){let e=n;ot().securityLevel!=="loose"&&(e=Ee.sanitizeUrl(n)),t.split(",").forEach(function(s){at(s)!==void 0&&(we(s,()=>{window.open(e,"_self")}),Rt[s]=e)}),Te(t,"clickable")},Te=function(t,n){t.split(",").forEach(function(e){let s=at(e);s!==void 0&&s.classes.push(n)})},Un=function(t,n,e){if(ot().securityLevel!=="loose"||n===void 0)return;let s=[];if(typeof e=="string"){s=e.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);for(let h=0;h<s.length;h++){let d=s[h].trim();d.charAt(0)==='"'&&d.charAt(d.length-1)==='"'&&(d=d.substr(1,d.length-2)),s[h]=d}}s.length===0&&s.push(t),at(t)!==void 0&&we(t,()=>{je.runFunc(n,...s)})},we=function(t,n){Ht.push(function(){const e=document.querySelector(`[id="${t}"]`);e!==null&&e.addEventListener("click",function(){n()})},function(){const e=document.querySelector(`[id="${t}-text"]`);e!==null&&e.addEventListener("click",function(){n()})})},Qn=function(t,n,e){t.split(",").forEach(function(s){Un(s,n,e)}),Te(t,"clickable")},Jn=function(t){Ht.forEach(function(n){n(t)})},Kn={getConfig:()=>ot().gantt,clear:pn,setDateFormat:Dn,getDateFormat:Ln,enableInclusiveEndDates:Cn,endDatesAreInclusive:En,enableTopAxis:Sn,topAxisEnabled:Mn,setAxisFormat:bn,getAxisFormat:vn,setTickInterval:xn,getTickInterval:Tn,setTodayMarker:wn,getTodayMarker:_n,setAccTitle:Ve,getAccTitle:Ne,setDiagramTitle:Re,getDiagramTitle:Be,setDisplayMode:An,getDisplayMode:In,setAccDescription:qe,getAccDescription:He,addSection:On,getSections:Vn,getTasks:Nn,addTask:Xn,findTaskById:at,addTaskOrg:Zn,setIncludes:Yn,getIncludes:Fn,setExcludes:Wn,getExcludes:Pn,setClickEvent:Qn,setLink:jn,getLinks:zn,bindFunctions:Jn,parseDuration:be,isInvalidDate:ge,setWeekday:Rn,getWeekday:Bn};function _e(t,n,e){let s=!0;for(;s;)s=!1,e.forEach(function(i){const h="^\\s*"+i+"\\s*$",d=new RegExp(h);t[0].match(d)&&(n[i]=!0,t.shift(1),s=!0)})}const $n=function(){_t.debug("Something is calling, setConf, remove the call")},ie={monday:Le,tuesday:Ye,wednesday:Fe,thursday:We,friday:Pe,saturday:ze,sunday:Oe},ts=(t,n)=>{let e=[...t].map(()=>-1/0),s=[...t].sort((h,d)=>h.startTime-d.startTime||h.order-d.order),i=0;for(const h of s)for(let d=0;d<e.length;d++)if(h.startTime>=e[d]){e[d]=h.endTime,h.order=d+n,d>i&&(i=d);break}return i};let $;const es=function(t,n,e,s){const i=ot().gantt,h=ot().securityLevel;let d;h==="sandbox"&&(d=pt("#i"+n));const v=h==="sandbox"?pt(d.nodes()[0].contentDocument.body):pt("body"),F=h==="sandbox"?d.nodes()[0].contentDocument:document,E=F.getElementById(n);$=E.parentElement.offsetWidth,$===void 0&&($=1200),i.useWidth!==void 0&&($=i.useWidth);const p=s.db.getTasks();let S=[];for(const k of p)S.push(k.type);S=X(S);const P={};let z=2*i.topPadding;if(s.db.getDisplayMode()==="compact"||i.displayMode==="compact"){const k={};for(const x of p)k[x.section]===void 0?k[x.section]=[x]:k[x.section].push(x);let T=0;for(const x of Object.keys(k)){const g=ts(k[x],T)+1;T+=g,z+=g*(i.barHeight+i.barGap),P[x]=g}}else{z+=p.length*(i.barHeight+i.barGap);for(const k of S)P[k]=p.filter(T=>T.type===k).length}E.setAttribute("viewBox","0 0 "+$+" "+z);const N=v.select(`[id="${n}"]`),C=Se().domain([sn(p,function(k){return k.startTime}),nn(p,function(k){return k.endTime})]).rangeRound([0,$-i.leftPadding-i.rightPadding]);function b(k,T){const x=k.startTime,g=T.startTime;let a=0;return x>g?a=1:x<g&&(a=-1),a}p.sort(b),D(p,$,z),Xe(N,z,$,i.useMaxWidth),N.append("text").text(s.db.getDiagramTitle()).attr("x",$/2).attr("y",i.titleTopMargin).attr("class","titleText");function D(k,T,x){const g=i.barHeight,a=g+i.barGap,u=i.topPadding,f=i.leftPadding,c=Me().domain([0,S.length]).range(["#00B9FA","#F95002"]).interpolate(en);Y(a,u,f,T,x,k,s.db.getExcludes(),s.db.getIncludes()),q(f,u,T,x),I(k,a,u,f,g,c,T),H(a,u),U(f,u,T,x)}function I(k,T,x,g,a,u,f){const y=[...new Set(k.map(o=>o.order))].map(o=>k.find(m=>m.order===o));N.append("g").selectAll("rect").data(y).enter().append("rect").attr("x",0).attr("y",function(o,m){return m=o.order,m*T+x-2}).attr("width",function(){return f-i.rightPadding/2}).attr("height",T).attr("class",function(o){for(const[m,L]of S.entries())if(o.type===L)return"section section"+m%i.numberSectionStyles;return"section section0"});const r=N.append("g").selectAll("rect").data(k).enter(),W=s.db.getLinks();if(r.append("rect").attr("id",function(o){return o.id}).attr("rx",3).attr("ry",3).attr("x",function(o){return o.milestone?C(o.startTime)+g+.5*(C(o.endTime)-C(o.startTime))-.5*a:C(o.startTime)+g}).attr("y",function(o,m){return m=o.order,m*T+x}).attr("width",function(o){return o.milestone?a:C(o.renderEndTime||o.endTime)-C(o.startTime)}).attr("height",a).attr("transform-origin",function(o,m){return m=o.order,(C(o.startTime)+g+.5*(C(o.endTime)-C(o.startTime))).toString()+"px "+(m*T+x+.5*a).toString()+"px"}).attr("class",function(o){const m="task";let L="";o.classes.length>0&&(L=o.classes.join(" "));let w=0;for(const[_,A]of S.entries())o.type===A&&(w=_%i.numberSectionStyles);let M="";return o.active?o.crit?M+=" activeCrit":M=" active":o.done?o.crit?M=" doneCrit":M=" done":o.crit&&(M+=" crit"),M.length===0&&(M=" task"),o.milestone&&(M=" milestone "+M),M+=w,M+=" "+L,m+M}),r.append("text").attr("id",function(o){return o.id+"-text"}).text(function(o){return o.task}).attr("font-size",i.fontSize).attr("x",function(o){let m=C(o.startTime),L=C(o.renderEndTime||o.endTime);o.milestone&&(m+=.5*(C(o.endTime)-C(o.startTime))-.5*a),o.milestone&&(L=m+a);const w=this.getBBox().width;return w>L-m?L+w+1.5*i.leftPadding>f?m+g-5:L+g+5:(L-m)/2+m+g}).attr("y",function(o,m){return m=o.order,m*T+i.barHeight/2+(i.fontSize/2-2)+x}).attr("text-height",a).attr("class",function(o){const m=C(o.startTime);let L=C(o.endTime);o.milestone&&(L=m+a);const w=this.getBBox().width;let M="";o.classes.length>0&&(M=o.classes.join(" "));let _=0;for(const[it,rt]of S.entries())o.type===rt&&(_=it%i.numberSectionStyles);let A="";return o.active&&(o.crit?A="activeCritText"+_:A="activeText"+_),o.done?o.crit?A=A+" doneCritText"+_:A=A+" doneText"+_:o.crit&&(A=A+" critText"+_),o.milestone&&(A+=" milestoneText"),w>L-m?L+w+1.5*i.leftPadding>f?M+" taskTextOutsideLeft taskTextOutside"+_+" "+A:M+" taskTextOutsideRight taskTextOutside"+_+" "+A+" width-"+w:M+" taskText taskText"+_+" "+A+" width-"+w}),ot().securityLevel==="sandbox"){let o;o=pt("#i"+n);const m=o.nodes()[0].contentDocument;r.filter(function(L){return W[L.id]!==void 0}).each(function(L){var w=m.querySelector("#"+L.id),M=m.querySelector("#"+L.id+"-text");const _=w.parentNode;var A=m.createElement("a");A.setAttribute("xlink:href",W[L.id]),A.setAttribute("target","_top"),_.appendChild(A),A.appendChild(w),A.appendChild(M)})}}function Y(k,T,x,g,a,u,f,c){if(f.length===0&&c.length===0)return;let y,r;for(const{startTime:w,endTime:M}of u)(y===void 0||w<y)&&(y=w),(r===void 0||M>r)&&(r=M);if(!y||!r)return;if(B(r).diff(B(y),"year")>5){_t.warn("The difference between the min and max time is more than 5 years. This will cause performance issues. Skipping drawing exclude days.");return}const W=s.db.getDateFormat(),l=[];let o=null,m=B(y);for(;m.valueOf()<=r;)s.db.isInvalidDate(m,W,f,c)?o?o.end=m:o={start:m,end:m}:o&&(l.push(o),o=null),m=m.add(1,"d");N.append("g").selectAll("rect").data(l).enter().append("rect").attr("id",function(w){return"exclude-"+w.start.format("YYYY-MM-DD")}).attr("x",function(w){return C(w.start)+x}).attr("y",i.gridLineStartPadding).attr("width",function(w){const M=w.end.add(1,"day");return C(M)-C(w.start)}).attr("height",a-T-i.gridLineStartPadding).attr("transform-origin",function(w,M){return(C(w.start)+x+.5*(C(w.end)-C(w.start))).toString()+"px "+(M*k+.5*a).toString()+"px"}).attr("class","exclude-range")}function q(k,T,x,g){let a=Ae(C).tickSize(-g+T+i.gridLineStartPadding).tickFormat(Zt(s.db.getAxisFormat()||i.axisFormat||"%Y-%m-%d"));const f=/^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/.exec(s.db.getTickInterval()||i.tickInterval);if(f!==null){const c=f[1],y=f[2],r=s.db.getWeekday()||i.weekday;switch(y){case"millisecond":a.ticks($t.every(c));break;case"second":a.ticks(Kt.every(c));break;case"minute":a.ticks(Jt.every(c));break;case"hour":a.ticks(Qt.every(c));break;case"day":a.ticks(Ut.every(c));break;case"week":a.ticks(ie[r].every(c));break;case"month":a.ticks(jt.every(c));break}}if(N.append("g").attr("class","grid").attr("transform","translate("+k+", "+(g-50)+")").call(a).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10).attr("dy","1em"),s.db.topAxisEnabled()||i.topAxis){let c=Ie(C).tickSize(-g+T+i.gridLineStartPadding).tickFormat(Zt(s.db.getAxisFormat()||i.axisFormat||"%Y-%m-%d"));if(f!==null){const y=f[1],r=f[2],W=s.db.getWeekday()||i.weekday;switch(r){case"millisecond":c.ticks($t.every(y));break;case"second":c.ticks(Kt.every(y));break;case"minute":c.ticks(Jt.every(y));break;case"hour":c.ticks(Qt.every(y));break;case"day":c.ticks(Ut.every(y));break;case"week":c.ticks(ie[W].every(y));break;case"month":c.ticks(jt.every(y));break}}N.append("g").attr("class","grid").attr("transform","translate("+k+", "+T+")").call(c).selectAll("text").style("text-anchor","middle").attr("fill","#000").attr("stroke","none").attr("font-size",10)}}function H(k,T){let x=0;const g=Object.keys(P).map(a=>[a,P[a]]);N.append("g").selectAll("text").data(g).enter().append(function(a){const u=a[0].split(Ze.lineBreakRegex),f=-(u.length-1)/2,c=F.createElementNS("http://www.w3.org/2000/svg","text");c.setAttribute("dy",f+"em");for(const[y,r]of u.entries()){const W=F.createElementNS("http://www.w3.org/2000/svg","tspan");W.setAttribute("alignment-baseline","central"),W.setAttribute("x","10"),y>0&&W.setAttribute("dy","1em"),W.textContent=r,c.appendChild(W)}return c}).attr("x",10).attr("y",function(a,u){if(u>0)for(let f=0;f<u;f++)return x+=g[u-1][1],a[1]*k/2+x*k+T;else return a[1]*k/2+T}).attr("font-size",i.sectionFontSize).attr("class",function(a){for(const[u,f]of S.entries())if(a[0]===f)return"sectionTitle sectionTitle"+u%i.numberSectionStyles;return"sectionTitle"})}function U(k,T,x,g){const a=s.db.getTodayMarker();if(a==="off")return;const u=N.append("g").attr("class","today"),f=new Date,c=u.append("line");c.attr("x1",C(f)+k).attr("x2",C(f)+k).attr("y1",i.titleTopMargin).attr("y2",g-i.titleTopMargin).attr("class","today"),a!==""&&c.attr("style",a.replace(/,/g,";"))}function X(k){const T={},x=[];for(let g=0,a=k.length;g<a;++g)Object.prototype.hasOwnProperty.call(T,k[g])||(T[k[g]]=!0,x.push(k[g]));return x}},ns={setConf:$n,draw:es},ss=t=>`
  .mermaid-main-font {
    font-family: var(--mermaid-font-family, "trebuchet ms", verdana, arial, sans-serif);
  }

  .exclude-range {
    fill: ${t.excludeBkgColor};
  }

  .section {
    stroke: none;
    opacity: 0.2;
  }

  .section0 {
    fill: ${t.sectionBkgColor};
  }

  .section2 {
    fill: ${t.sectionBkgColor2};
  }

  .section1,
  .section3 {
    fill: ${t.altSectionBkgColor};
    opacity: 0.2;
  }

  .sectionTitle0 {
    fill: ${t.titleColor};
  }

  .sectionTitle1 {
    fill: ${t.titleColor};
  }

  .sectionTitle2 {
    fill: ${t.titleColor};
  }

  .sectionTitle3 {
    fill: ${t.titleColor};
  }

  .sectionTitle {
    text-anchor: start;
    font-family: var(--mermaid-font-family, "trebuchet ms", verdana, arial, sans-serif);
  }


  /* Grid and axis */

  .grid .tick {
    stroke: ${t.gridColor};
    opacity: 0.8;
    shape-rendering: crispEdges;
  }

  .grid .tick text {
    font-family: ${t.fontFamily};
    fill: ${t.textColor};
  }

  .grid path {
    stroke-width: 0;
  }


  /* Today line */

  .today {
    fill: none;
    stroke: ${t.todayLineColor};
    stroke-width: 2px;
  }


  /* Task styling */

  /* Default task */

  .task {
    stroke-width: 2;
  }

  .taskText {
    text-anchor: middle;
    font-family: var(--mermaid-font-family, "trebuchet ms", verdana, arial, sans-serif);
  }

  .taskTextOutsideRight {
    fill: ${t.taskTextDarkColor};
    text-anchor: start;
    font-family: var(--mermaid-font-family, "trebuchet ms", verdana, arial, sans-serif);
  }

  .taskTextOutsideLeft {
    fill: ${t.taskTextDarkColor};
    text-anchor: end;
  }


  /* Special case clickable */

  .task.clickable {
    cursor: pointer;
  }

  .taskText.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideLeft.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }

  .taskTextOutsideRight.clickable {
    cursor: pointer;
    fill: ${t.taskTextClickableColor} !important;
    font-weight: bold;
  }


  /* Specific task settings for the sections*/

  .taskText0,
  .taskText1,
  .taskText2,
  .taskText3 {
    fill: ${t.taskTextColor};
  }

  .task0,
  .task1,
  .task2,
  .task3 {
    fill: ${t.taskBkgColor};
    stroke: ${t.taskBorderColor};
  }

  .taskTextOutside0,
  .taskTextOutside2
  {
    fill: ${t.taskTextOutsideColor};
  }

  .taskTextOutside1,
  .taskTextOutside3 {
    fill: ${t.taskTextOutsideColor};
  }


  /* Active task */

  .active0,
  .active1,
  .active2,
  .active3 {
    fill: ${t.activeTaskBkgColor};
    stroke: ${t.activeTaskBorderColor};
  }

  .activeText0,
  .activeText1,
  .activeText2,
  .activeText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Completed task */

  .done0,
  .done1,
  .done2,
  .done3 {
    stroke: ${t.doneTaskBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
  }

  .doneText0,
  .doneText1,
  .doneText2,
  .doneText3 {
    fill: ${t.taskTextDarkColor} !important;
  }


  /* Tasks on the critical line */

  .crit0,
  .crit1,
  .crit2,
  .crit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.critBkgColor};
    stroke-width: 2;
  }

  .activeCrit0,
  .activeCrit1,
  .activeCrit2,
  .activeCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.activeTaskBkgColor};
    stroke-width: 2;
  }

  .doneCrit0,
  .doneCrit1,
  .doneCrit2,
  .doneCrit3 {
    stroke: ${t.critBorderColor};
    fill: ${t.doneTaskBkgColor};
    stroke-width: 2;
    cursor: pointer;
    shape-rendering: crispEdges;
  }

  .milestone {
    transform: rotate(45deg) scale(0.8,0.8);
  }

  .milestoneText {
    font-style: italic;
  }
  .doneCritText0,
  .doneCritText1,
  .doneCritText2,
  .doneCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .activeCritText0,
  .activeCritText1,
  .activeCritText2,
  .activeCritText3 {
    fill: ${t.taskTextDarkColor} !important;
  }

  .titleText {
    text-anchor: middle;
    font-size: 18px;
    fill: ${t.titleColor||t.textColor};
    font-family: var(--mermaid-font-family, "trebuchet ms", verdana, arial, sans-serif);
  }
`,is=ss,cs={parser:gn,db:Kn,renderer:ns,styles:is};export{cs as diagram};

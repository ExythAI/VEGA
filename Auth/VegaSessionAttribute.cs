using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using VEGA.Interfaces;

namespace VEGA.Auth;

/// <summary>
/// Requires a valid VEGA session cookie. On success, sets HttpContext.Items["UserName"].
/// If the action also has [AllowFirstUser] and no users are enrolled, the check is bypassed
/// (used so the very first operator can enroll themselves).
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false)]
public sealed class VegaSessionAttribute : Attribute, IAuthorizationFilter
{
    public const string UserNameItemKey = "VegaUserName";
    public const string SessionIdItemKey = "VegaSessionId";
    public const string CookieName = "vega_session";

    public void OnAuthorization(AuthorizationFilterContext context)
    {
        var sessionService = context.HttpContext.RequestServices.GetRequiredService<ISessionService>();

        var sessionId = context.HttpContext.Request.Cookies[CookieName];
        var userName = sessionService.GetUser(sessionId ?? string.Empty);

        if (userName != null)
        {
            context.HttpContext.Items[UserNameItemKey] = userName;
            context.HttpContext.Items[SessionIdItemKey] = sessionId;
            return;
        }

        // Bootstrap exception: allow if endpoint is marked [AllowFirstUser] and no users exist yet.
        var allowsFirstUser = context.ActionDescriptor.EndpointMetadata
            .OfType<AllowFirstUserAttribute>().Any();

        if (allowsFirstUser)
        {
            var faceService = context.HttpContext.RequestServices.GetRequiredService<IFaceRecognitionService>();
            if (!faceService.GetEnrolledUsers().Any())
            {
                return; // Bootstrap path: no enrolled users, anyone may enroll the first.
            }
        }

        context.Result = new UnauthorizedObjectResult(new { error = "Authentication required." });
    }
}

/// <summary>
/// When combined with [VegaSession], allows the request through (without a valid session)
/// if no users are currently enrolled. Used to bootstrap the first operator.
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public sealed class AllowFirstUserAttribute : Attribute { }
